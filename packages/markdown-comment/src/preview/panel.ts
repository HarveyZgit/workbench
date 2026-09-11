// Host 侧：WebviewPanel 生命周期 + postMessage 协议 + 文档重渲 + 评论增删改。
// host 独占 storage，webview 是纯视图：所有改动 webview→postMessage→host 写盘→host 推回。
// 注：webview 自身发起的改动会即时回推；源码侧/CLI/Agent 改 storage 后回灌 webview 留到 MW4。
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  loadDoc,
  saveDoc,
  fileHash,
  storageKey,
  ensureUntitledCliId,
  skillPromptTargetState,
} from '../storage';
import {
  documentContentAttempts,
  findMatchingDocument,
  implicitFileWorkspaceRoot,
  normalizeFileFsPath,
  pickSourceText,
  readSavedMarkdownText,
  resolveLocalResourcePath,
  sameDocumentUri,
  SOURCE_UNREADABLE_MESSAGE,
  unsupportedSchemeMessage,
} from '../document-uri';
import { hasMarkdownExtension, isCommentableMarkdown, isMarkdownDocument } from '../markdown-lang';
import { isSavedDocumentScheme, VSCODE_LOCAL_SCHEME } from '../uri-scheme';
import { buildAnchorFromRange, relocate } from '../anchor';
import { createDocumentThread, createSelectionThreadFromText, persistThread } from './selection-thread';
import {
  CREATE_REJECTED_MESSAGE,
  isCreateIntent,
  isWebviewMessage,
  MAX_LINK_LENGTH,
  normalizeLineSpan,
  normalizeRenderedSelection,
} from './protocol';
import { PlainTextDocument, type TextModel } from '../text-model';
import type { StoredDocument, StoredThread } from '../types';
import { computePreviewLineChanges } from './diff';
import { findHeadingLine } from './heading';
import type {
  HostToWebview,
  PreviewLineChanges,
  PreviewRenderOptions,
  RenderedSelection,
  ResolvedPreviewResource,
  WireThread,
} from './messages';

const RENDER_DEBOUNCE_MS = 150;
const OPEN_DOCUMENT_TIMEOUT_MS = 1_500;
const MAX_STYLE_FILES = 10;
const MAX_STYLE_FILE_SIZE = 1_000_000;
const MAX_STYLE_TOTAL_SIZE = 2_000_000;
const MAX_DIFF_DOCUMENT_SIZE = 200_000;
const MAX_DIFF_DOCUMENT_LINES = 10_000;

interface PreviewController {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  rebind: (next: vscode.Uri) => void;
  dispose: () => void;
}

// uri.toString() → 该文档的预览控制器（一个文档至多一个预览）。
const previews = new Map<string, PreviewController>();

const keyOf = (uri: vscode.Uri) => uri.toString();

function nonce(): string {
  return randomUUID().replace(/-/g, '');
}

function docFor(uri: vscode.Uri): vscode.TextDocument | undefined {
  return findMatchingDocument(vscode.workspace.textDocuments, uri);
}

function renderOptions(
  webview: vscode.Webview,
  uri: vscode.Uri,
  styles: string[] = [],
): PreviewRenderOptions {
  const config = vscode.workspace.getConfiguration('markdownComment.preview', uri);
  const rawFontFamily = config.get<string>('fontFamily', '').trim();
  const fontSize = Math.min(40, Math.max(8, config.get<number>('fontSize', 14)));
  const lineHeight = Math.min(3, Math.max(1, config.get<number>('lineHeight', 1.7)));
  const renderedDiff = config.get<boolean>('renderedDiff', true);
  return {
    frontMatter: config.get<PreviewRenderOptions['frontMatter']>('frontMatter', 'table'),
    scrollPreviewWithEditor: config.get<boolean>('scrollPreviewWithEditor', true),
    scrollEditorWithPreview: config.get<boolean>('scrollEditorWithPreview', true),
    doubleClickToSwitchToEditor: config.get<boolean>('doubleClickToSwitchToEditor', false),
    styles,
    fontFamily: rawFontFamily && rawFontFamily.length <= 500 ? rawFontFamily : undefined,
    fontSize,
    lineHeight,
    breaks: config.get<boolean>('breaks', false),
    typographer: config.get<boolean>('typographer', false),
    html: config.get<PreviewRenderOptions['html']>('html', 'strict'),
    renderedDiff,
    mermaidNodeComments: config.get<boolean>('mermaidNodeComments', false),
  };
}

function documentDirUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (!isSavedDocumentScheme(uri.scheme)) {
    return undefined;
  }
  return vscode.Uri.joinPath(uri, '..');
}

function localResourceRoots(context: vscode.ExtensionContext, uri: vscode.Uri): vscode.Uri[] {
  const dir = documentDirUri(uri);
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'dist'),
    // 保留原 scheme（vscode-local / vscode-remote），不要改写成 file:。
    ...(dir ? [dir] : []),
    ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
  ];
  return roots.filter(
    (root, index) => roots.findIndex((candidate) => keyOf(candidate) === keyOf(root)) === index,
  );
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function realPath(candidate: string): string | null {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return null;
  }
}

function allowedRootUris(uri: vscode.Uri): vscode.Uri[] {
  const roots: vscode.Uri[] = [];
  const dir = documentDirUri(uri);
  if (dir) {
    roots.push(dir);
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    roots.push(folder.uri);
  }
  return roots.filter(
    (root, index) => roots.findIndex((candidate) => keyOf(candidate) === keyOf(root)) === index,
  );
}

/** file: 能 realpath 时做规范；远程看不见的本机路径则只比较规范化 fsPath。 */
function canonicalizeFileUri(uri: vscode.Uri): vscode.Uri {
  if (uri.scheme !== 'file') {
    return uri;
  }
  const resolved = realPath(uri.fsPath);
  return resolved ? vscode.Uri.file(resolved) : uri;
}

function uriInsideRoot(root: vscode.Uri, candidate: vscode.Uri): boolean {
  if (root.scheme !== candidate.scheme || root.authority !== candidate.authority) {
    return false;
  }
  const rootCanon = canonicalizeFileUri(root);
  const candCanon = canonicalizeFileUri(candidate);
  return isInside(
    normalizeFileFsPath(rootCanon.fsPath || rootCanon.path),
    normalizeFileFsPath(candCanon.fsPath || candCanon.path),
  );
}

function withDocumentScheme(
  base: vscode.Uri,
  absolutePath: string,
  query: string,
  fragment: string,
): vscode.Uri {
  const fileUri = vscode.Uri.file(absolutePath);
  if (base.scheme === 'file') {
    return fileUri.with({ query, fragment });
  }
  return fileUri.with({
    scheme: base.scheme,
    authority: base.authority,
    query,
    fragment,
  });
}

function splitResourceReference(source: string): { path: string; suffix: string } {
  const index = source.search(/[?#]/);
  return index < 0
    ? { path: source, suffix: '' }
    : { path: source.slice(0, index), suffix: source.slice(index) };
}

function resolveLocalReference(uri: vscode.Uri, source: string): vscode.Uri | null {
  const trimmed = source.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return null;
  }
  const reference = splitResourceReference(trimmed);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(reference.path);
  } catch {
    return null;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  // untitled：没有可靠的磁盘 dirname，相对路径本地资源直接放弃（https / data 仍由调用方放行）。
  // 无 folder 包含该文档时：用文件所在目录当隐式根，不误用远程 workspaceFolders[0]。
  if (!isSavedDocumentScheme(uri.scheme) && !decodedPath.startsWith('/')) {
    return null;
  }
  const absolutePath = resolveLocalResourcePath(
    decodedPath,
    isSavedDocumentScheme(uri.scheme) ? uri.fsPath : undefined,
    workspaceFolder?.uri.fsPath ?? implicitFileWorkspaceRoot(uri),
  );
  if (!absolutePath) {
    return null;
  }
  const query = reference.suffix.startsWith('?') ? reference.suffix.slice(1).split('#')[0] : '';
  const fragment = reference.suffix.includes('#')
    ? reference.suffix.slice(reference.suffix.indexOf('#') + 1)
    : '';
  const resolved = withDocumentScheme(uri, absolutePath, query, fragment);
  if (!allowedRootUris(uri).some((root) => uriInsideRoot(root, resolved))) {
    return null;
  }
  return resolved;
}

async function resolvePreviewStyles(
  webview: vscode.Webview,
  uri: vscode.Uri,
  sources: string[],
): Promise<string[]> {
  if (!vscode.workspace.isTrusted || !Array.isArray(sources)) {
    return [];
  }
  const styles: string[] = [];
  let totalSize = 0;
  for (const source of sources.slice(0, MAX_STYLE_FILES)) {
    if (
      typeof source !== 'string' ||
      source.length > MAX_LINK_LENGTH ||
      path.extname(source).toLowerCase() !== '.css'
    ) {
      continue;
    }
    const resolved = resolveLocalReference(uri, source);
    if (!resolved) {
      continue;
    }
    try {
      const { size } = await vscode.workspace.fs.stat(resolved);
      if (size > MAX_STYLE_FILE_SIZE || totalSize + size > MAX_STYLE_TOTAL_SIZE) {
        continue;
      }
      totalSize += size;
      styles.push(webview.asWebviewUri(resolved).toString(true));
    } catch {
      // 文件不存在或不可读时忽略该样式。
    }
  }
  return styles;
}

async function readLineChanges(uri: vscode.Uri, current: string): Promise<PreviewLineChanges | undefined> {
  if (
    current.length > MAX_DIFF_DOCUMENT_SIZE ||
    current.split(/\r?\n/, MAX_DIFF_DOCUMENT_LINES + 1).length > MAX_DIFF_DOCUMENT_LINES
  ) {
    return undefined;
  }
  let baseline: string | undefined;
  try {
    baseline = new TextDecoder('utf8').decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    if (uri.scheme === 'file') {
      try {
        baseline = fs.readFileSync(uri.fsPath, 'utf8');
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  if (
    baseline.length > MAX_DIFF_DOCUMENT_SIZE ||
    baseline.split(/\r?\n/, MAX_DIFF_DOCUMENT_LINES + 1).length > MAX_DIFF_DOCUMENT_LINES
  ) {
    return undefined;
  }
  return computePreviewLineChanges(baseline, current);
}

function lineForFragment(doc: TextModel, fragment: string): number | null {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // 无法解码时继续使用原 fragment。
  }
  return findHeadingLine(doc.getText(), decoded);
}

function mermaidBlockEndLine(doc: TextModel, startLine: number): number {
  const opening = /^(?: {0,3})(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i.exec(doc.lineAt(startLine).text);
  if (!opening) {
    return startLine + 1;
  }
  const marker = opening[1][0];
  const minimumLength = opening[1].length;
  for (let line = startLine + 1; line < doc.lineCount; line++) {
    const closing = new RegExp(`^(?: {0,3})${marker}{${minimumLength},}\\s*$`).exec(doc.lineAt(line).text);
    if (closing) {
      return line + 1;
    }
  }
  return doc.lineCount;
}

function mermaidBlockNear(doc: TextModel, line: number): { startLine: number; endLine: number } | null {
  const blocks: Array<{ startLine: number; endLine: number }> = [];
  for (let candidate = 0; candidate < doc.lineCount; candidate++) {
    if (!/^(?: {0,3})(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i.test(doc.lineAt(candidate).text)) {
      continue;
    }
    const endLine = mermaidBlockEndLine(doc, candidate);
    blocks.push({ startLine: candidate, endLine });
    candidate = Math.max(candidate, endLine - 1);
  }
  return blocks.find((block) => block.startLine <= line && line < block.endLine) ?? null;
}

function nodeCanReadFsPath(fsPath: string): boolean {
  if (!fsPath) {
    return false;
  }
  try {
    fs.accessSync(fsPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function contentAttemptOptions(uri: vscode.Uri) {
  return {
    nodeCanReadFsPath: isSavedDocumentScheme(uri.scheme) && nodeCanReadFsPath(uri.fsPath),
    remoteName: vscode.env.remoteName,
  };
}

function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.then(
    (value) => value,
    () => undefined,
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settle(promise),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function openVia(
  uri: vscode.Uri,
  via: 'original' | 'file-uri' | 'fsPath' | 'vscode-local',
): Promise<vscode.TextDocument> {
  switch (via) {
    case 'original':
      return Promise.resolve(vscode.workspace.openTextDocument(uri));
    case 'file-uri':
      return Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath)));
    case 'fsPath':
      return Promise.resolve(vscode.workspace.openTextDocument(uri.fsPath));
    case 'vscode-local':
      return Promise.resolve(vscode.workspace.openTextDocument(uri.with({ scheme: VSCODE_LOCAL_SCHEME })));
    default: {
      const unexpected: never = via;
      return Promise.reject(new Error(`unexpected open via: ${String(unexpected)}`));
    }
  }
}

// 拿源文档：优先已打开的（file / vscode-local 按 fsPath 匹配），再按 URI 尝试打开。
// 远程窗口的本机文件不要改写成 file: + Node 路径；必要时试 vscode-local。
// openTextDocument 加超时：预览顶掉唯一标签后，部分宿主（Trae Remote）会挂起。
async function getDoc(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const open = docFor(uri);
  if (open) {
    return open;
  }
  for (const step of documentContentAttempts(uri, contentAttemptOptions(uri))) {
    if (step.type !== 'open') {
      continue;
    }
    const doc = await withTimeout(openVia(uri, step.via), OPEN_DOCUMENT_TIMEOUT_MS);
    if (doc) {
      return doc;
    }
  }
  return undefined;
}

async function readSourceText(uri: vscode.Uri): Promise<string | undefined> {
  for (const step of documentContentAttempts(uri, contentAttemptOptions(uri))) {
    if (step.type !== 'read') {
      continue;
    }
    try {
      switch (step.via) {
        case 'workspace-fs': {
          const bytes = await vscode.workspace.fs.readFile(uri);
          return new TextDecoder('utf8').decode(bytes);
        }
        case 'workspace-fs-vscode-local': {
          const bytes = await vscode.workspace.fs.readFile(uri.with({ scheme: VSCODE_LOCAL_SCHEME }));
          return new TextDecoder('utf8').decode(bytes);
        }
        case 'node-fs':
          return readSavedMarkdownText(uri.fsPath);
        default:
          break;
      }
    } catch {
      // 换下一种读取方式。
    }
  }
  return undefined;
}

/**
 * StoredThread → webview 用的精简表示；返回 null 表示这条在当前文本里**不展示**。
 * 传入当前 doc 时对划词锚点做**读时** relocate：内容变动后高亮跟着原文走（不写回存储）。
 * relocate 失败（原文被完整删除/替换、全文都搜不到）→ 返回 null，预览里隐藏这条评论。
 * 数据仍留在 storage；若原文恢复，下次 relocate 成功会重新出现并定位。引用文本始终用冻结快照。
 */
function toWire(t: StoredThread, doc?: TextModel): WireThread {
  let { startLine } = t.anchor;
  let { endLine } = t.anchor;
  let orphaned = false;
  if (doc && t.anchor.kind === 'selection') {
    const r = relocate(doc, t.anchor);
    if (!r) {
      if (t.anchor.target?.kind === 'mermaid-node') {
        const block = mermaidBlockNear(doc, t.anchor.startLine);
        if (!block) {
          orphaned = true;
        } else {
          startLine = block.startLine;
          endLine = block.endLine - 1;
        }
      } else {
        orphaned = true;
      }
    } else {
      startLine = r.start.line;
      endLine =
        t.anchor.target?.kind === 'mermaid-diagram' ? mermaidBlockEndLine(doc, startLine) - 1 : r.end.line;
    }
  }
  return {
    id: t.id,
    status: t.status,
    kind: t.anchor.kind,
    blockStartLine: startLine,
    blockEndLine: endLine + 1,
    quote: t.anchor.quote,
    rendered: t.anchor.rendered,
    target: t.anchor.target,
    orphaned: orphaned || undefined,
    comments: t.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt })),
  };
}

const STYLE = `
:root { color-scheme: light dark; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--mdc-preview-font-family, var(--vscode-font-family));
  font-size: var(--mdc-preview-font-size, var(--vscode-font-size, 14px));
  line-height: var(--mdc-preview-line-height, 1.7);
  color: var(--vscode-foreground);
}
#app { position: relative; display: flex; height: 100vh; }
#content { flex: 1; min-width: 0; overflow: auto; padding: 24px clamp(16px, 6%, 80px) 80px; box-sizing: border-box; }

/* 左侧大纲（飞书文档风格：无边框，干净树） */
#outline {
  width: 220px; flex: none; overflow: auto; box-sizing: border-box;
  border: none;
  background: transparent;
  display: flex; flex-direction: column; min-height: 0;
  transition: width .23s cubic-bezier(0.4, 0, 0.2, 1), opacity .23s ease, min-width .23s ease;
}
#outline-head {
  position: sticky; top: 0; z-index: 5;
  display: flex; justify-content: space-between; align-items: center; gap: 4px;
  padding: 8px 8px 4px 12px;
  background: transparent;
  border: none;
}
#outline-title {
  font-size: 0.82em; font-weight: 600; opacity: 0.85;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#mdc-toggle-outline { flex: none; opacity: 0.72; }
#outline-tree {
  flex: 1; min-height: 0; overflow: auto;
  padding: 4px 6px 16px;
  font-size: 0.86em;
}
#outline-tree:empty::before {
  content: '暂无标题';
  display: block; padding: 12px 8px; opacity: 0.5; font-size: 0.95em;
}
.outline-list { list-style: none; margin: 0; padding: 0; }
.outline-node { margin: 0; }
.outline-row {
  display: flex; align-items: center; gap: 2px;
  border-radius: 4px; min-height: 28px;
  padding-right: 6px;
}
.outline-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
.outline-row.active {
  background: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.18));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}
.outline-row.active .outline-label { color: var(--vscode-textLink-foreground, #3794ff); font-weight: 600; }
.outline-twisty {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: none; border-radius: 3px;
  background: transparent; color: var(--vscode-foreground); opacity: 0.55; cursor: pointer;
  outline: none;
}
.outline-twisty:focus,
.outline-twisty:focus-visible { outline: none; box-shadow: none; }
.outline-twisty:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.outline-twisty[aria-hidden="true"] { visibility: hidden; pointer-events: none; }
.outline-twisty svg { display: block; transition: transform .22s cubic-bezier(0.4, 0, 0.2, 1); }
.outline-node.collapsed > .outline-row .outline-twisty svg { transform: rotate(-90deg); }
.outline-node > .outline-list {
  overflow: hidden;
  max-height: 2400px;
  opacity: 1;
  transition: max-height .24s cubic-bezier(0.4, 0, 0.2, 1), opacity .22s ease;
}
.outline-node.collapsed > .outline-list {
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}
.outline-label {
  flex: 1; min-width: 0; padding: 4px 2px;
  color: inherit; text-decoration: none; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.35;
  outline: none;
}
.outline-label:focus,
.outline-label:focus-visible { outline: none; box-shadow: none; }
.outline-label:hover { color: var(--vscode-textLink-foreground); }
/* 收起后不留细条：整栏隐藏，改用浮动 peek 图标 */
#app.outline-collapsed #outline {
  width: 0; min-width: 0; padding: 0; margin: 0; border: none;
  overflow: hidden; opacity: 0; pointer-events: none;
}

#sidebar {
  width: 320px; flex: none; overflow: auto; box-sizing: border-box;
  border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  background: var(--vscode-sideBar-background, transparent);
  transition: width .23s cubic-bezier(0.4, 0, 0.2, 1), opacity .23s ease, min-width .23s ease, border-width .23s ease;
}

h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; }
h1 { font-size: 1.9em; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); padding-bottom: 0.25em; }
p, ul, ol, blockquote, table, pre { margin: 0.7em 0; }
a { color: var(--vscode-textLink-foreground); }
code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.92em;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
  border-radius: 3px;
  padding: 0.15em 0.35em;
}
pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12)); padding: 12px 14px; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding: 0.2em 1em; border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.4)); color: var(--vscode-descriptionForeground); }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); padding: 6px 12px; }
th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12)); }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); margin: 1.6em 0; }
ul.contains-task-list,
ol.contains-task-list { list-style: none; padding-left: 1.2em; }
.task-list-item { list-style: none; }
.task-list-item-checkbox {
  margin: 0 0.5em 0 0;
  vertical-align: middle;
  pointer-events: none;
}
.mdc-alert,
.markdown-alert {
  border-left: 0.25em solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.45));
  padding: 0.5em 1em;
  margin: 1em 0;
  background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
}
.mdc-alert-note, .markdown-alert-note { border-left-color: #0969da; }
.mdc-alert-tip, .markdown-alert-tip { border-left-color: #1a7f37; }
.mdc-alert-important, .markdown-alert-important { border-left-color: #8250df; }
.mdc-alert-warning, .markdown-alert-warning { border-left-color: #9a6700; }
.mdc-alert-caution, .markdown-alert-caution { border-left-color: #cf222e; }
.mdc-alert-title,
.markdown-alert-title {
  font-weight: 600;
  margin: 0 0 0.35em;
}
.footnotes-sep { margin-top: 2em; }
.footnotes { font-size: 0.92em; opacity: 0.92; }
.footnote-ref { font-size: 0.85em; }
.footnote-backref { text-decoration: none; margin-left: 0.25em; }

/* 高亮 */
mark.mdc-hl { background: rgba(255, 209, 102, 0.28); border-radius: 2px; cursor: pointer; color: inherit; transition: background-color .15s, box-shadow .15s; }
mark.mdc-hl.resolved { background: rgba(140, 140, 140, 0.20); }
mark.mdc-hl.active { background: rgba(255, 167, 38, 0.5); box-shadow: 0 0 0 1px rgba(255, 167, 38, 0.55); }
.mdc-block-hl { background: rgba(255, 209, 102, 0.12); cursor: pointer; transition: background-color .15s; }
.mdc-block-hl.active { background: rgba(255, 167, 38, 0.20); }

/* 侧栏 */
#sidebar-head {
  position: sticky; top: 0; z-index: 5;
  display: flex; justify-content: space-between; align-items: center; gap: 4px; padding: 8px 6px 8px 4px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
}
#mdc-tabs {
  display: flex; gap: 1px; min-width: 0; flex: 1; flex-wrap: nowrap; overflow-x: auto;
  scrollbar-width: none;
}
#mdc-tabs::-webkit-scrollbar { display: none; }
.mdc-tab {
  display: inline-flex; align-items: center; gap: 3px; flex: none; white-space: nowrap;
  font-size: 0.82em; padding: 3px 6px; border: none; border-radius: 999px; cursor: pointer;
  background: transparent; color: var(--vscode-foreground); opacity: 0.65;
}
.mdc-tab:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
.mdc-tab.active { opacity: 1; font-weight: 600; background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.22)); }
.mdc-tab-n {
  display: none; min-width: 16px; padding: 0 5px; border-radius: 999px;
  font-size: 0.88em; line-height: 16px; text-align: center; font-weight: 600;
  background: var(--vscode-badge-background, rgba(128,128,128,0.35)); color: var(--vscode-badge-foreground, inherit);
}
.mdc-tab-n.show { display: inline-block; }
#mdc-head-actions { display: flex; align-items: center; gap: 2px; flex: none; }
#mdc-head-actions .mdc-icon { flex: none; opacity: 0.72; }
#mdc-head-actions .mdc-icon:hover { opacity: 1; }
#mdc-copy-skill:disabled {
  opacity: 0.32; cursor: default;
}
#mdc-copy-skill:disabled:hover { opacity: 0.32; background: transparent; }
#mdc-toggle-sidebar { flex: none; opacity: 0.72; }
#app.sidebar-collapsed #sidebar {
  width: 0; min-width: 0; padding: 0; margin: 0; border: none;
  overflow: hidden; opacity: 0; pointer-events: none;
}
#sidebar-inner { padding: 12px; }

/* 收起后的浮动 peek 按钮（目录 / 评论）——置顶，visibility+opacity 淡入淡出 */
.mdc-peek {
  position: absolute; z-index: 40;
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; padding: 0; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526));
  color: var(--vscode-foreground);
  box-shadow: 0 2px 12px rgba(0,0,0,0.28);
  visibility: hidden; opacity: 0; pointer-events: none;
  transform: scale(0.88);
  transition: opacity .22s ease, transform .22s cubic-bezier(0.4, 0, 0.2, 1), visibility .22s;
}
.mdc-peek:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.mdc-peek svg { display: block; }
#mdc-peek-outline { left: 12px; top: 10px; }
#mdc-peek-sidebar { right: 12px; top: 10px; }
#app.outline-collapsed #mdc-peek-outline,
#app.sidebar-collapsed #mdc-peek-sidebar {
  visibility: visible; opacity: 0.94; pointer-events: auto; transform: scale(1);
}
#app.outline-collapsed #mdc-peek-outline:hover,
#app.sidebar-collapsed #mdc-peek-sidebar:hover { opacity: 1; }
#mdc-peek-outline.mdc-tip::after,
#mdc-peek-outline.mdc-tip:hover::after {
  left: calc(100% + 8px); right: auto; top: 50%; margin-top: 0;
  transform: translateY(-50%);
}
#mdc-peek-sidebar.mdc-tip::after,
#mdc-peek-sidebar.mdc-tip:hover::after {
  right: calc(100% + 8px); left: auto; top: 50%; margin-top: 0;
  transform: translateY(-50%);
}
.mdc-empty { opacity: 0.6; padding: 16px 6px; font-size: 0.9em; }
.mdc-card {
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: 8px; padding: 10px; margin-bottom: 10px; cursor: pointer;
  background: var(--vscode-editor-background, transparent);
}
.mdc-card { transition: border-color .15s, box-shadow .15s; }
.mdc-card.resolved { opacity: 0.6; }
.mdc-card.active { opacity: 1; border-color: var(--vscode-focusBorder); box-shadow: inset 3px 0 0 var(--vscode-focusBorder); }
.mdc-card.orphaned { opacity: 0.7; }
.mdc-orphaned-tag {
  display: inline-block; font-size: 0.75em; padding: 1px 6px; border-radius: 3px;
  background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,0.15));
  color: var(--vscode-inputValidation-warningForeground, #cc0);
  vertical-align: middle; margin-right: 4px;
}
.mdc-card-head { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 8px; }
.mdc-card-quote {
  flex: 1; min-width: 0; font-size: 0.8em; opacity: 0.75; padding-left: 6px; line-height: 22px;
  border-left: 2px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.4));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mdc-card-tools { flex: none; display: flex; gap: 2px; }
.mdc-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: var(--vscode-foreground); opacity: 0.55; cursor: pointer;
}
.mdc-icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.mdc-icon svg { display: block; }
.mdc-icon.resolve.on { color: var(--vscode-charts-green, #3fb950); opacity: 0.95; }

/* 图标悬浮提示 */
.mdc-tip { position: relative; }
.mdc-tip::after {
  content: attr(data-tip); position: absolute; top: 100%; right: 0; margin-top: 5px;
  padding: 3px 7px; border-radius: 4px; font-size: 11px; line-height: 1.3; white-space: nowrap;
  background: var(--vscode-editorHoverWidget-background, #252526);
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,0.3));
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  opacity: 0; transform: translateY(2px); pointer-events: none; transition: opacity .12s, transform .12s; z-index: 50;
}
.mdc-tip:hover::after { opacity: 1; transform: translateY(0); }

.mdc-cmt { position: relative; margin: 8px 0; font-size: 0.9em; word-break: break-word; }
.mdc-cmt-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.mdc-author { font-weight: 600; }
.mdc-author.agent { color: var(--vscode-charts-green, #4caf50); }
.mdc-time { font-size: 0.82em; opacity: 0.5; }
.mdc-cmt-tools { margin-left: auto; flex: none; display: flex; gap: 2px; }
.mdc-cmt-tools .mdc-icon { width: 20px; height: 20px; opacity: 0; }
.mdc-cmt:hover .mdc-cmt-tools .mdc-icon { opacity: 0.5; }
.mdc-cmt-tools .mdc-icon:hover { opacity: 1 !important; }
.mdc-body { white-space: pre-wrap; }
.mdc-edit { margin: 4px 0 2px; }
.mdc-edit .mdc-card-actions { margin-top: 6px; }

.mdc-card-reply { position: relative; margin-top: 8px; }
textarea.mdc-reply, textarea.mdc-draft-input, textarea.mdc-edit-input {
  width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;
  font-size: 0.9em; line-height: 1.5; padding: 6px; border-radius: 4px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
}
textarea.mdc-edit-input { min-height: 56px; }
textarea.mdc-reply { min-height: 34px; padding-right: 36px; }
/* 发送按钮：输入框有内容（非 placeholder 态）才显示 */
.mdc-icon.mdc-send {
  position: absolute; right: 6px; bottom: 7px; width: 26px; height: 26px; display: none; opacity: 0.95;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
.mdc-icon.mdc-send:hover { opacity: 1; background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.mdc-reply:not(:placeholder-shown) ~ .mdc-icon.mdc-send { display: inline-flex; }

/* 新建评论草稿卡（在侧栏顶部，独立于线程列表，刷新不冲掉） */
#sidebar-draft:not(:empty) { padding: 12px 12px 0; }
.mdc-draft { border: 1px solid var(--vscode-focusBorder); border-radius: 8px; padding: 10px; background: var(--vscode-editor-background, transparent); }
textarea.mdc-draft-input { min-height: 76px; margin: 8px 0; }
.mdc-card-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mdc-card-actions button {
  font-size: 0.85em; padding: 3px 12px; border: none; border-radius: 4px; cursor: pointer;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, inherit);
}
.mdc-card-actions button[data-act="submit"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
`;

function buildHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  title: string,
): string {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `connect-src ${webview.cspSource} https:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<link rel="stylesheet" href="${styleUri}" />
<style>${STYLE}</style>
</head>
<body>
<div id="app">
  <aside id="outline">
    <div id="outline-head">
      <span id="outline-title">大纲</span>
      <button id="mdc-toggle-outline" class="mdc-icon mdc-tip" data-tip="收起目录" aria-label="收起目录" aria-expanded="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4l-4 4 4 4"/></svg></button>
    </div>
    <nav id="outline-tree" aria-label="大纲"></nav>
  </aside>
  <button type="button" id="mdc-peek-outline" class="mdc-peek mdc-tip" data-tip="展开目录" aria-label="展开目录" title="展开目录"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M3 8h10M3 11.5h7"/><path d="M3 4.5v7"/></svg></button>
  <main id="content"></main>
  <button type="button" id="mdc-peek-sidebar" class="mdc-peek mdc-tip" data-tip="展开评论" aria-label="展开评论" title="展开评论"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H8.2L5 13.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"/></svg></button>
  <aside id="sidebar">
    <div id="sidebar-head">
      <div id="mdc-tabs">
        <button class="mdc-tab active" data-tab="open">未解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="resolved">已解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="all">全部<span class="mdc-tab-n"></span></button>
      </div>
      <div id="mdc-head-actions">
        <button type="button" id="mdc-add-doc" class="mdc-icon mdc-tip" data-tip="全文评论" aria-label="全文评论" title="全文评论"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h5.5L12.5 5.5V13.5H4z"/><path d="M9.5 2.5V5.5h3"/><path d="M6 8h4.5M6 10.5h3"/><circle cx="11.2" cy="11.2" r="2.3"/><path d="M11.2 10.2v2M10.2 11.2h2"/></svg></button>
        <button type="button" id="mdc-copy-skill" class="mdc-icon mdc-tip" data-tip="复制 Skill 提示" aria-label="复制 Skill 提示" title="复制 Skill 提示"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="3" width="7" height="9" rx="1.2"/><path d="M4 5.5H3.5A1.5 1.5 0 0 0 2 7v5.5A1.5 1.5 0 0 0 3.5 14H9"/><path d="M7.5 6.5h3M7.5 9h3"/></svg></button>
        <button id="mdc-toggle-sidebar" class="mdc-icon mdc-tip" data-tip="收起评论" aria-label="收起评论" aria-expanded="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg></button>
      </div>
    </div>
    <div id="sidebar-draft"></div>
    <div id="sidebar-inner"></div>
  </aside>
</div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** 当前绑定文档的 Skill 提示目标（file=绝对路径；untitled=cliId 或禁用）。 */
function skillPromptStateFor(storageDir: string, uri: vscode.Uri) {
  // 存量 untitled：有评论但缺 cliId 时 ensure 回填，无需再发一条评论。
  const cliId = uri.scheme === 'untitled' ? ensureUntitledCliId(storageDir, storageKey(uri)) : undefined;
  return skillPromptTargetState({ scheme: uri.scheme, fsPath: uri.fsPath, cliId });
}

function previewTitle(uri: vscode.Uri): string {
  if (uri.scheme === 'untitled') {
    const name = uri.path || uri.toString().replace(/^untitled:/, '') || 'Untitled';
    return `评论预览：${name}`;
  }
  return `评论预览：${path.basename(uri.fsPath)}`;
}

function previewFor(uri: vscode.Uri): PreviewController | undefined {
  const direct = previews.get(keyOf(uri));
  if (direct) {
    return direct;
  }
  for (const ctrl of previews.values()) {
    if (sameDocumentUri(ctrl.uri, uri)) {
      return ctrl;
    }
  }
  return undefined;
}

export function hasPreview(uri: vscode.Uri): boolean {
  return previewFor(uri) !== undefined;
}

/** untitled Save As 成 file 后：把已打开的预览改绑到新 URI，不丢 webview。 */
export function rebindPreview(fromUri: vscode.Uri, toUri: vscode.Uri): void {
  if (keyOf(fromUri) === keyOf(toUri)) {
    return;
  }
  const ctrl = previews.get(keyOf(fromUri));
  if (!ctrl) {
    return;
  }
  previews.delete(keyOf(fromUri));
  // 若目标已有预览，关掉旧的，保留迁移来的（含未提交草稿态更完整）。
  const conflict = previews.get(keyOf(toUri));
  if (conflict) {
    conflict.dispose();
    conflict.panel.dispose();
    previews.delete(keyOf(toUri));
  }
  ctrl.rebind(toUri);
  previews.set(keyOf(toUri), ctrl);
}

export function openPreview(context: vscode.ExtensionContext, editor?: vscode.TextEditor): void {
  const ed = editor ?? vscode.window.activeTextEditor;
  if (!ed) {
    vscode.window.showInformationMessage('请在 Markdown 文件中打开评论预览');
    return;
  }
  if (!isCommentableMarkdown(ed.document.languageId, ed.document.uri)) {
    const looksMarkdown =
      ed.document.languageId === 'markdown' || hasMarkdownExtension(ed.document.uri.fsPath);
    if (looksMarkdown) {
      vscode.window.showErrorMessage(unsupportedSchemeMessage(ed.document.uri.scheme));
    } else {
      vscode.window.showInformationMessage('请在 Markdown 文件中打开评论预览');
    }
    return;
  }
  const { uri } = ed.document;
  const existing = previewFor(uri);
  if (existing) {
    existing.panel.reveal();
    return;
  }

  // Capture before createWebviewPanel: ViewColumn.Active replaces the only tab
  // in a folderless / Remote×local window, and the TextDocument may disappear.
  let cachedSourceText: string | undefined = ed.document.getText();

  const storageDir = context.globalStorageUri.fsPath;
  const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
  // 可变绑定：Save As 后 rebind 更新，闭包内读写均走 boundUri / docKey。
  let boundUri = uri;
  const docKey = () => storageKey(boundUri);
  const panel = vscode.window.createWebviewPanel(
    'markdownCommentPreview',
    previewTitle(uri),
    vscode.ViewColumn.Active,
    // enableFindWidget：让 webview 支持 Cmd/Ctrl+F 唤起 VS Code 查找框，在渲染预览文本里搜索。
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: localResourceRoots(context, uri),
    },
  );
  const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
  const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.css'));
  panel.webview.html = buildHtml(panel.webview, scriptUri, styleUri, panel.title);

  const post = (msg: HostToWebview) => void panel.webview.postMessage(msg);
  const wireFor = (doc?: TextModel) => loadDoc(storageDir, docKey()).threads.map((t) => toWire(t, doc));
  const rememberSource = (text: string | undefined) => {
    if (text !== undefined) {
      cachedSourceText = text;
    }
  };
  const resolvePreviewModel = async (): Promise<{
    vscodeDoc?: vscode.TextDocument;
    model?: TextModel;
  }> => {
    const vscodeDoc = docFor(boundUri);
    const openText = vscodeDoc?.getText();
    if (openText) {
      rememberSource(openText);
      return { vscodeDoc, model: vscodeDoc };
    }
    // Tab gone (preview replaced the only editor): use the snapshot immediately.
    // Do not await workspace.fs / openTextDocument — those can hang on Trae Remote×local.
    if (cachedSourceText !== undefined && cachedSourceText.length > 0) {
      return { vscodeDoc, model: PlainTextDocument.fromString(cachedSourceText) };
    }
    const readText = await withTimeout(readSourceText(boundUri), OPEN_DOCUMENT_TIMEOUT_MS);
    const picked = pickSourceText({
      openText,
      readText,
      cachedText: cachedSourceText,
    });
    if (picked !== undefined) {
      rememberSource(picked);
      if (vscodeDoc && (openText?.length || picked === openText)) {
        return { vscodeDoc, model: vscodeDoc };
      }
      return { vscodeDoc, model: PlainTextDocument.fromString(picked) };
    }
    const opened = await getDoc(boundUri);
    if (opened) {
      rememberSource(opened.getText());
      return { vscodeDoc: opened, model: opened };
    }
    return { vscodeDoc, model: undefined };
  };
  // 取当前文本来 relocate（源码 tab 没开则用缓存 / workspace.fs），保证回推 webview 的行号是最新的。
  const sendThreads = async () => {
    const { model } = await resolvePreviewModel();
    post({ type: 'threads', threads: wireFor(model) });
  };
  const sendSkillPromptTarget = () => {
    const state = skillPromptStateFor(storageDir, boundUri);
    post({ type: 'skillPromptTarget', enabled: state.enabled, tip: state.tip });
  };
  let reportedUnreadable = false;
  const sendRender = async () => {
    const { vscodeDoc, model } = await resolvePreviewModel();
    if (!model && !reportedUnreadable) {
      reportedUnreadable = true;
      vscode.window.showErrorMessage(SOURCE_UNREADABLE_MESSAGE);
    }
    const text = model?.getText() ?? cachedSourceText ?? '';
    const styleSources = vscode.workspace
      .getConfiguration('markdownComment.preview', boundUri)
      .get<string[]>('styles', []);
    const options = renderOptions(
      panel.webview,
      boundUri,
      await resolvePreviewStyles(panel.webview, boundUri, styleSources),
    );
    const encoding =
      vscodeDoc &&
      'encoding' in vscodeDoc &&
      typeof (vscodeDoc as vscode.TextDocument & { encoding?: unknown }).encoding === 'string'
        ? (vscodeDoc as vscode.TextDocument & { encoding: string }).encoding.toLowerCase()
        : 'utf8';
    const changes =
      options.renderedDiff &&
      vscodeDoc?.isDirty &&
      encoding === 'utf8' &&
      isSavedDocumentScheme(boundUri.scheme)
        ? await readLineChanges(boundUri, text)
        : undefined;
    post({
      type: 'render',
      text,
      threads: wireFor(model),
      options,
      diff: changes ? { baseline: 'saved', changes } : undefined,
    });
  };

  // 改 storage 后即时回推 webview（源码侧由 fs.watch 自行重载）。
  const mutate = (fn: (doc: StoredDocument) => void) => {
    try {
      const stored = loadDoc(storageDir, docKey());
      fn(stored);
      saveDoc(storageDir, docKey(), stored);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`无法保存评论：${detail}`);
      return;
    }
    void sendThreads();
    sendSkillPromptTarget();
  };

  const handleCreate = async (selection: RenderedSelection, text: string) => {
    if (!text.trim()) {
      return;
    }
    const openText = docFor(boundUri)?.getText();
    let sourceText = pickSourceText({ openText, cachedText: cachedSourceText });
    if (sourceText === undefined || sourceText.length === 0) {
      const { model } = await resolvePreviewModel();
      sourceText = model?.getText() ?? '';
    }
    const result = createSelectionThreadFromText(
      sourceText,
      normalizeRenderedSelection(selection),
      text,
    );
    if (!result.ok) {
      if (result.error !== 'empty') {
        vscode.window.showWarningMessage(result.error);
      }
      return;
    }
    const saved = persistThread(storageDir, docKey(), result.thread);
    if (!saved.ok) {
      vscode.window.showErrorMessage(saved.error);
      return;
    }
    void sendThreads();
    sendSkillPromptTarget();
  };

  const handleCreateBlock = async (
    startLine: number,
    endLine: number,
    label: string,
    target: 'mermaid-diagram',
    text: string,
  ) => {
    if (!text.trim()) {
      return;
    }
    const { model } = await resolvePreviewModel();
    const doc = model;
    const span = normalizeLineSpan(startLine, endLine);
    const safeStartLine = doc ? Math.min(Math.max(0, span.startLine), Math.max(0, doc.lineCount - 1)) : 0;
    const range = doc ? doc.lineAt(safeStartLine).range : null;
    if (!doc || !range) {
      vscode.window.showWarningMessage(SOURCE_UNREADABLE_MESSAGE);
      return;
    }
    const anchor = buildAnchorFromRange(doc, range, 'selection');
    anchor.rendered = { quote: label, before: '', after: '' };
    anchor.target = { kind: target };
    mutate((stored) =>
      stored.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
      }),
    );
  };

  const handleCreateNode = async (
    startLine: number,
    endLine: number,
    label: string,
    nodeId: string,
    text: string,
  ) => {
    if (!text.trim()) {
      return;
    }
    const { model } = await resolvePreviewModel();
    const doc = model;
    const span = normalizeLineSpan(startLine, endLine);
    const safeStartLine = doc ? Math.min(Math.max(0, span.startLine), Math.max(0, doc.lineCount - 1)) : 0;
    const range = doc ? doc.lineAt(safeStartLine).range : null;
    if (!doc || !range) {
      vscode.window.showWarningMessage(SOURCE_UNREADABLE_MESSAGE);
      return;
    }
    const anchor = buildAnchorFromRange(doc, range, 'selection');
    anchor.rendered = { quote: label, before: '', after: '' };
    anchor.target = { kind: 'mermaid-node', nodeId };
    mutate((stored) =>
      stored.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
      }),
    );
  };

  const resolveResources = async (sources: string[]): Promise<ResolvedPreviewResource[]> => {
    const resources: ResolvedPreviewResource[] = [];
    for (const source of sources) {
      if (/^https:/i.test(source) || /^data:image\//i.test(source)) {
        resources.push({ source, uri: source });
        continue;
      }
      const resolved = resolveLocalReference(boundUri, source);
      if (!resolved) {
        resources.push({ source, error: '不允许读取该资源路径' });
        continue;
      }
      try {
        await vscode.workspace.fs.stat(resolved);
        resources.push({ source, uri: panel.webview.asWebviewUri(resolved).toString(true) });
      } catch {
        if (resolved.scheme === 'file' && fs.existsSync(resolved.fsPath)) {
          resources.push({ source, uri: panel.webview.asWebviewUri(resolved).toString(true) });
        } else {
          resources.push({ source, error: '资源文件不存在' });
        }
      }
    }
    return resources;
  };

  const openLink = async (href: string) => {
    const trimmed = href.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.startsWith('#')) {
      post({ type: 'revealLine', line: 0 });
      return;
    }
    let parsed: vscode.Uri | undefined;
    try {
      parsed = vscode.Uri.parse(trimmed, true);
    } catch {
      parsed = undefined;
    }
    if (parsed && ['https', 'http', 'mailto'].includes(parsed.scheme)) {
      await vscode.env.openExternal(parsed);
      return;
    }
    const resolved = resolveLocalReference(boundUri, trimmed);
    if (!resolved) {
      vscode.window.showWarningMessage(`不支持打开链接：${href}`);
      return;
    }
    if (isMarkdownDocument('', resolved.fsPath)) {
      const targetDoc = await vscode.workspace.openTextDocument(resolved.with({ query: '', fragment: '' }));
      const targetEditor = await vscode.window.showTextDocument(targetDoc);
      if (resolved.fragment) {
        const line = lineForFragment(targetDoc, resolved.fragment);
        if (line !== null) {
          const { range } = targetDoc.lineAt(line);
          targetEditor.selection = new vscode.Selection(range.start, range.start);
          targetEditor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        }
      }
      return;
    }
    await vscode.commands.executeCommand('vscode.open', resolved);
  };

  const openImage = async (source: string) => {
    if (/^https:/i.test(source)) {
      await vscode.env.openExternal(vscode.Uri.parse(source, true));
      return;
    }
    const resolved = resolveLocalReference(boundUri, source);
    if (resolved) {
      await vscode.commands.executeCommand('vscode.open', resolved.with({ query: '', fragment: '' }));
    }
  };

  const revealSourceLine = async (line: number, preserveFocus = false) => {
    const doc = await getDoc(boundUri);
    if (!doc) {
      return;
    }
    const safeLine = Math.min(Math.max(0, Math.floor(line)), Math.max(0, doc.lineCount - 1));
    const { range } = doc.lineAt(safeLine);
    const shown = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus,
      preview: false,
    });
    shown.revealRange(range, vscode.TextEditorRevealType.AtTop);
    if (!preserveFocus) {
      shown.selection = new vscode.Selection(range.start, range.start);
    }
  };

  const revealSource = async (threadId: string) => {
    const t = loadDoc(storageDir, docKey()).threads.find((x) => x.id === threadId);
    if (!t) {
      return;
    }
    const doc = await getDoc(boundUri);
    if (!doc) {
      vscode.window.showWarningMessage(SOURCE_UNREADABLE_MESSAGE);
      return;
    }
    // 全文评论：只打开文档，不定位到某一行。
    if (t.anchor.kind === 'document') {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
      return;
    }
    const located = relocate(doc, t.anchor);
    const fallback =
      t.anchor.target?.kind === 'mermaid-node'
        ? (() => {
            const block = mermaidBlockNear(doc, t.anchor.startLine);
            return block
              ? doc.lineAt(block.startLine).range
              : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
          })()
        : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const hit = located ?? fallback;
    const range = new vscode.Range(hit.start.line, hit.start.character, hit.end.line, hit.end.character);
    const shown = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
    shown.selection = new vscode.Selection(range.start, range.end);
    shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressPreviewScrollUntil = 0;
  let suppressEditorScrollUntil = 0;
  const scheduleRender = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void sendRender(), RENDER_DEBOUNCE_MS);
  };

  const subs: vscode.Disposable[] = [
    panel.webview.onDidReceiveMessage((value: unknown) => {
      if (!isWebviewMessage(value)) {
        if (isCreateIntent(value)) {
          vscode.window.showWarningMessage(CREATE_REJECTED_MESSAGE);
        }
        return;
      }
      const msg = value;
      switch (msg.type) {
        case 'ready':
          void sendRender();
          sendSkillPromptTarget();
          break;
        case 'createThread':
          void handleCreate(msg.selection, msg.text);
          break;
        case 'createBlockThread':
          void handleCreateBlock(msg.startLine, msg.endLine, msg.label, msg.target, msg.text);
          break;
        case 'createMermaidNodeThread':
          void handleCreateNode(msg.startLine, msg.endLine, msg.label, msg.nodeId, msg.text);
          break;
        case 'createDocThread': {
          const created = createDocumentThread(msg.text);
          if (!created.ok) {
            if (created.error !== 'empty') {
              vscode.window.showWarningMessage(created.error);
            }
            break;
          }
          const saved = persistThread(storageDir, docKey(), created.thread);
          if (!saved.ok) {
            vscode.window.showErrorMessage(saved.error);
            break;
          }
          void sendThreads();
          sendSkillPromptTarget();
          break;
        }
        case 'reply':
          mutate((d) => {
            const t = d.threads.find((x) => x.id === msg.threadId);
            if (t) {
              t.comments.push({
                id: randomUUID(),
                author: 'user',
                body: msg.text,
                createdAt: new Date().toISOString(),
              });
            }
          });
          break;
        case 'editComment':
          if (msg.text.trim()) {
            mutate((d) => {
              const c = d.threads
                .find((x) => x.id === msg.threadId)
                ?.comments.find((y) => y.id === msg.commentId);
              if (c) {
                c.body = msg.text;
              }
            });
          }
          break;
        case 'resolve':
          mutate((d) => {
            const t = d.threads.find((x) => x.id === msg.threadId);
            if (t) {
              t.status = msg.resolved ? 'resolved' : 'open';
            }
          });
          break;
        case 'deleteComment':
          mutate((d) => {
            const t = d.threads.find((x) => x.id === msg.threadId);
            if (t) {
              t.comments = t.comments.filter((c) => c.id !== msg.commentId);
            }
            // 评论删空了，整条 thread 一并移除。
            d.threads = d.threads.filter((x) => x.comments.length > 0);
          });
          break;
        case 'deleteThread':
          mutate((d) => {
            d.threads = d.threads.filter((x) => x.id !== msg.threadId);
          });
          break;
        case 'revealSource':
          void revealSource(msg.threadId);
          break;
        case 'resolveResources':
          void resolveResources(msg.sources).then((resources) => {
            post({
              type: 'resolvedResources',
              requestId: msg.requestId,
              resources,
            });
          });
          break;
        case 'openLink':
          void openLink(msg.href);
          break;
        case 'openImage':
          void openImage(msg.source);
          break;
        case 'copyImageFallback':
          void vscode.env.clipboard.writeText(msg.source);
          break;
        case 'copySkillPrompt': {
          const state = skillPromptStateFor(storageDir, boundUri);
          if (!state.enabled || !state.prompt) {
            sendSkillPromptTarget();
            break;
          }
          void vscode.env.clipboard.writeText(state.prompt).then(() => {
            post({ type: 'skillPromptCopied' });
          });
          break;
        }
        case 'revealSourceLine':
          suppressPreviewScrollUntil = Date.now() + 200;
          void revealSourceLine(msg.line);
          break;
        case 'previewScroll': {
          if (
            !renderOptions(panel.webview, boundUri).scrollEditorWithPreview ||
            Date.now() < suppressEditorScrollUntil
          ) {
            break;
          }
          const editor = vscode.window.visibleTextEditors.find((candidate) =>
            sameDocumentUri(candidate.document.uri, boundUri),
          );
          if (!editor) {
            break;
          }
          const safeLine = Math.min(
            Math.max(0, Math.floor(msg.line)),
            Math.max(0, editor.document.lineCount - 1),
          );
          suppressPreviewScrollUntil = Date.now() + 200;
          editor.revealRange(editor.document.lineAt(safeLine).range, vscode.TextEditorRevealType.AtTop);
          break;
        }
        default: {
          const unexpected: never = msg;
          throw new Error(`unexpected webview message: ${JSON.stringify(unexpected)}`);
        }
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (sameDocumentUri(e.document.uri, boundUri)) {
        rememberSource(e.document.getText());
        scheduleRender();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (sameDocumentUri(doc.uri, boundUri)) {
        void sendRender();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('markdownComment.preview', boundUri)) {
        void sendRender();
      }
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (
        !sameDocumentUri(e.textEditor.document.uri, boundUri) ||
        !renderOptions(panel.webview, boundUri).scrollPreviewWithEditor ||
        Date.now() < suppressPreviewScrollUntil
      ) {
        return;
      }
      const line = e.visibleRanges[0]?.start.line;
      if (typeof line === 'number') {
        suppressEditorScrollUntil = Date.now() + 200;
        post({ type: 'revealLine', line });
      }
    }),
  ];

  // 监听本文档的 storage 文件：源码侧 / CLI / Agent 改了评论 → 回灌 webview。
  // 不区分写入方（含本预览自身的写），重复 sendThreads 是幂等的。
  const docsDir = path.join(storageDir, 'docs');
  let myHash = fileHash(docKey());
  let watcher: fs.FSWatcher | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    fs.mkdirSync(docsDir, { recursive: true });
    watcher = fs.watch(docsDir, (_event, filename) => {
      if (!filename || String(filename).replace(/\.json$/, '') !== myHash) {
        return;
      }
      if (watchTimer) {
        clearTimeout(watchTimer);
      }
      watchTimer = setTimeout(() => {
        void sendThreads();
        sendSkillPromptTarget();
      }, 120);
    });
  } catch {
    // 平台/文件系统不支持 fs.watch：外部改动不自动回灌，webview 自身改动仍即时刷新。
  }

  const controller: PreviewController = {
    panel,
    get uri() {
      return boundUri;
    },
    rebind(next: vscode.Uri) {
      boundUri = next;
      myHash = fileHash(docKey());
      reportedUnreadable = false;
      panel.title = previewTitle(next);
      void sendRender();
      sendSkillPromptTarget();
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
      }
      if (watchTimer) {
        clearTimeout(watchTimer);
      }
      watcher?.close();
      subs.forEach((d) => d.dispose());
    },
  };
  previews.set(keyOf(boundUri), controller);
  panel.onDidDispose(() => {
    controller.dispose();
    previews.delete(keyOf(controller.uri));
  });
}
