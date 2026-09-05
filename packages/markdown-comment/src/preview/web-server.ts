// Local browser preview host: HTTP + WebSocket, reuses webview UI and comment store.
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadDoc, saveDoc, fileHash } from '../storage';
import { buildAnchorFromRange, mapRenderedSelectionToRange, relocate } from '../anchor';
import { PlainTextDocument } from '../text-model';
import { hasMarkdownExtension } from '../markdown-lang';
import type { StoredDocument, StoredThread } from '../types';
import type {
  HostToWebview,
  PreviewRenderOptions,
  RenderedSelection,
  ResolvedPreviewResource,
  WebviewToHost,
  WireThread,
} from './messages';

const RENDER_DEBOUNCE_MS = 150;
const MAX_RESOURCE_REQUESTS = 100;
const MAX_ID_LENGTH = 256;
const MAX_COMMENT_LENGTH = 100_000;
const MAX_SELECTION_QUOTE_LENGTH = 200_000;
const MAX_SELECTION_CONTEXT_LENGTH = 1_000;
const MAX_LABEL_LENGTH = 500;
const MAX_LINK_LENGTH = 4_096;

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
#app { display: flex; height: 100vh; }
#content { flex: 1; min-width: 0; overflow: auto; padding: 24px clamp(16px, 6%, 80px) 80px; box-sizing: border-box; }
#sidebar {
  width: 320px; flex: none; overflow: auto; box-sizing: border-box;
  border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  background: var(--vscode-sideBar-background, transparent);
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
ul.contains-task-list { list-style: none; padding-left: 1.2em; }
.task-list-item-checkbox { margin-right: 0.5em; }

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
#mdc-add-doc {
  flex: none; font-size: 0.82em; padding: 4px 7px; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, inherit);
}
#mdc-add-doc:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.3)); }
#mdc-toggle-sidebar { flex: none; opacity: 0.72; }
#app.sidebar-collapsed #sidebar {
  width: 40px; overflow: visible;
}
#app.sidebar-collapsed #mdc-tabs,
#app.sidebar-collapsed #mdc-add-doc,
#app.sidebar-collapsed #sidebar-draft,
#app.sidebar-collapsed #sidebar-inner { display: none; }
#app.sidebar-collapsed #sidebar-head {
  justify-content: center; padding: 8px 4px; border-bottom: none;
}
#app.sidebar-collapsed #mdc-toggle-sidebar.mdc-tip::after,
#app.sidebar-collapsed #mdc-toggle-sidebar.mdc-tip:hover::after {
  right: auto; left: 0; top: 50%; margin-top: 0; margin-right: 0; margin-left: -6px;
  transform: translate(-100%, -50%);
}
#sidebar-inner { padding: 12px; }
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

const VSCODE_CSS_VARS = `
:root {
  color-scheme: light;
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --vscode-font-size: 14px;
  --vscode-foreground: #1f1f1f;
  --vscode-editor-background: #ffffff;
  --vscode-editor-foreground: #1f1f1f;
  --vscode-sideBar-background: #f3f3f3;
  --vscode-widget-border: rgba(0, 0, 0, 0.14);
  --vscode-textLink-foreground: #0066bf;
  --vscode-textCodeBlock-background: rgba(0, 0, 0, 0.06);
  --vscode-textBlockQuote-border: rgba(0, 0, 0, 0.2);
  --vscode-descriptionForeground: #616161;
  --vscode-button-background: #0078d4;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #026ec1;
  --vscode-button-secondaryBackground: rgba(0, 0, 0, 0.08);
  --vscode-button-secondaryForeground: #1f1f1f;
  --vscode-input-background: #ffffff;
  --vscode-input-foreground: #1f1f1f;
  --vscode-input-border: rgba(0, 0, 0, 0.2);
  --vscode-focusBorder: #0078d4;
  --vscode-toolbar-hoverBackground: rgba(0, 0, 0, 0.08);
  --vscode-badge-background: rgba(0, 0, 0, 0.18);
  --vscode-badge-foreground: #1f1f1f;
  --vscode-editorHoverWidget-background: #ffffff;
  --vscode-editorHoverWidget-foreground: #1f1f1f;
  --vscode-editorHoverWidget-border: rgba(0, 0, 0, 0.14);
  --vscode-charts-green: #2ea043;
  --vscode-inputValidation-warningBackground: rgba(255, 204, 0, 0.18);
  --vscode-inputValidation-warningForeground: #9a6700;
  --vscode-editor-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
body { background: var(--vscode-editor-background); }
`;

export interface PreviewServerOptions {
  filePath: string;
  storageDir: string;
  port?: number;
  host?: string;
  distDir?: string;
}

export interface PreviewServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function defaultRenderOptions(): PreviewRenderOptions {
  return {
    frontMatter: 'table',
    scrollPreviewWithEditor: false,
    scrollEditorWithPreview: false,
    doubleClickToSwitchToEditor: false,
    styles: [],
    fontSize: 14,
    lineHeight: 1.7,
    breaks: false,
    typographer: false,
    html: 'strict',
    renderedDiff: false,
    mermaidNodeComments: true,
  };
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

function splitResourceReference(source: string): { path: string; suffix: string } {
  const index = source.search(/[?#]/);
  return index < 0
    ? { path: source, suffix: '' }
    : { path: source.slice(0, index), suffix: source.slice(index) };
}

function resolveLocalFile(mdFile: string, source: string, workspaceRoot: string): string | null {
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
  const absolutePath = decodedPath.startsWith('/')
    ? path.resolve(workspaceRoot, `.${decodedPath}`)
    : path.resolve(path.dirname(mdFile), decodedPath);
  const resolvedRealPath = realPath(absolutePath);
  const roots = [path.dirname(mdFile), workspaceRoot].map((r) => realPath(r)).filter((r): r is string => !!r);
  if (!resolvedRealPath || !roots.some((root) => isInside(root, resolvedRealPath))) {
    return null;
  }
  return resolvedRealPath;
}

function isWebviewMessage(value: unknown): value is WebviewToHost {
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof (value as { type: unknown }).type !== 'string'
  ) {
    return false;
  }
  const message = value as Record<string, unknown>;
  const hasBoundedString = (key: string, maximum: number) =>
    typeof message[key] === 'string' && (message[key] as string).length <= maximum;
  const hasId = (key: string) => hasBoundedString(key, MAX_ID_LENGTH);
  const hasComment = (key: string) => hasBoundedString(key, MAX_COMMENT_LENGTH);
  const hasFiniteNumber = (key: string) => typeof message[key] === 'number' && Number.isFinite(message[key]);
  const hasNonNegativeInteger = (key: string) =>
    typeof message[key] === 'number' && Number.isInteger(message[key]) && (message[key] as number) >= 0;
  switch (message.type) {
    case 'ready':
      return true;
    case 'createThread':
      if (!hasComment('text') || !message.selection || typeof message.selection !== 'object') {
        return false;
      }
      {
        const selection = message.selection as Record<string, unknown>;
        return (
          typeof selection.blockStartLine === 'number' &&
          Number.isInteger(selection.blockStartLine) &&
          selection.blockStartLine >= 0 &&
          typeof selection.blockEndLine === 'number' &&
          Number.isInteger(selection.blockEndLine) &&
          selection.blockEndLine > selection.blockStartLine &&
          typeof selection.quote === 'string' &&
          selection.quote.length <= MAX_SELECTION_QUOTE_LENGTH &&
          typeof selection.before === 'string' &&
          selection.before.length <= MAX_SELECTION_CONTEXT_LENGTH &&
          typeof selection.after === 'string' &&
          selection.after.length <= MAX_SELECTION_CONTEXT_LENGTH &&
          typeof selection.spansMultipleBlocks === 'boolean'
        );
      }
    case 'createBlockThread':
      return (
        hasComment('text') &&
        hasBoundedString('label', MAX_LABEL_LENGTH) &&
        message.target === 'mermaid-diagram' &&
        hasNonNegativeInteger('startLine') &&
        hasNonNegativeInteger('endLine') &&
        (message.endLine as number) > (message.startLine as number)
      );
    case 'createMermaidNodeThread':
      return (
        hasComment('text') &&
        hasBoundedString('label', MAX_LABEL_LENGTH) &&
        hasBoundedString('nodeId', MAX_ID_LENGTH) &&
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(message.nodeId as string) &&
        hasNonNegativeInteger('startLine') &&
        hasNonNegativeInteger('endLine') &&
        (message.endLine as number) > (message.startLine as number)
      );
    case 'createDocThread':
      return hasComment('text');
    case 'reply':
      return hasId('threadId') && hasComment('text');
    case 'resolve':
      return hasId('threadId') && typeof message.resolved === 'boolean';
    case 'deleteThread':
    case 'revealSource':
      return hasId('threadId');
    case 'editComment':
    case 'deleteComment':
      return (
        hasId('threadId') && hasId('commentId') && (message.type === 'deleteComment' || hasComment('text'))
      );
    case 'resolveResources':
      return (
        hasId('requestId') &&
        Array.isArray(message.sources) &&
        message.sources.length <= MAX_RESOURCE_REQUESTS &&
        message.sources.every((source) => typeof source === 'string' && source.length <= MAX_LINK_LENGTH)
      );
    case 'openLink':
      return hasBoundedString('href', MAX_LINK_LENGTH);
    case 'copyImageFallback':
    case 'openImage':
      return hasBoundedString('source', MAX_LINK_LENGTH);
    case 'revealSourceLine':
    case 'previewScroll':
      return hasFiniteNumber('line');
    default:
      return false;
  }
}

function readDocText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function mermaidBlockEndLine(doc: PlainTextDocument, startLine: number): number {
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

function mermaidBlockNear(
  doc: PlainTextDocument,
  line: number,
): { startLine: number; endLine: number } | null {
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

function toWire(t: StoredThread, doc?: PlainTextDocument): WireThread {
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

function mimeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function openExternal(target: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // best-effort
  }
}

// ─── Minimal WebSocket (text frames only) ─────────────────────────────

interface WsClient {
  socket: import('node:net').Socket;
  send: (data: string) => void;
  close: () => void;
}

function acceptWebSocket(
  req: http.IncomingMessage,
  socket: import('node:net').Socket,
  head: Buffer,
): WsClient | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return null;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  );
  if (head.length) {
    socket.unshift(head);
  }

  let buffer = Buffer.alloc(0);
  const listeners: Array<(data: string) => void> = [];

  const send = (data: string) => {
    const payload = Buffer.from(data, 'utf8');
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  const close = () => {
    try {
      socket.end();
    } catch {
      // ignore
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const second = buffer[1];
      const masked = (second & 0x80) !== 0;
      let len = second & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const high = buffer.readUInt32BE(2);
        const low = buffer.readUInt32BE(6);
        if (high !== 0 || low > 0x7fffffff) {
          close();
          return;
        }
        len = low;
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) return;
      const opcode = buffer[0] & 0x0f;
      let payload = buffer.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const decoded = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          decoded[i] = payload[i] ^ mask[i % 4];
        }
        payload = decoded;
      }
      buffer = buffer.subarray(offset + maskLen + len);
      if (opcode === 0x8) {
        close();
        return;
      }
      if (opcode === 0x9) {
        // ping → pong
        const pong = Buffer.alloc(2 + payload.length);
        pong[0] = 0x8a;
        pong[1] = payload.length;
        payload.copy(pong, 2);
        socket.write(pong);
        continue;
      }
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        for (const listener of listeners) listener(text);
      }
    }
  });

  return {
    socket,
    send,
    close,
    // internal
    onMessage(cb: (data: string) => void) {
      listeners.push(cb);
    },
  } as WsClient & { onMessage: (cb: (data: string) => void) => void };
}

function buildHtml(title: string, filePath: string): string {
  const fileJson = JSON.stringify(filePath);
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/webview.css" />
<style>${VSCODE_CSS_VARS}</style>
<style>${STYLE}</style>
</head>
<body>
<div id="app">
  <main id="content"></main>
  <aside id="sidebar">
    <div id="sidebar-head">
      <div id="mdc-tabs">
        <button class="mdc-tab active" data-tab="open">未解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="resolved">已解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="all">全部<span class="mdc-tab-n"></span></button>
      </div>
      <div id="mdc-head-actions">
        <button id="mdc-add-doc" title="对整篇文档添加评论">＋ 全文评论</button>
        <button id="mdc-toggle-sidebar" class="mdc-icon mdc-tip" data-tip="收起侧边栏" aria-label="收起侧边栏" aria-expanded="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg></button>
      </div>
    </div>
    <div id="sidebar-draft"></div>
    <div id="sidebar-inner"></div>
  </aside>
</div>
<script>
window.acquireVsCodeApi = function () {
  var FILE = ${fileJson};
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var ws = new WebSocket(proto + '//' + location.host + '/ws?file=' + encodeURIComponent(FILE));
  var queue = [];
  var opened = false;
  ws.addEventListener('open', function () {
    opened = true;
    for (var i = 0; i < queue.length; i++) ws.send(queue[i]);
    queue = [];
  });
  ws.addEventListener('message', function (e) {
    try {
      var data = JSON.parse(e.data);
      window.dispatchEvent(new MessageEvent('message', { data: data }));
    } catch (err) {
      console.error('bad host message', err);
    }
  });
  return {
    postMessage: function (msg) {
      var raw = JSON.stringify(msg);
      if (opened && ws.readyState === 1) ws.send(raw);
      else queue.push(raw);
    },
    getState: function () { return null; },
    setState: function () {},
  };
};
</script>
<script src="/webview.js"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!hasMarkdownExtension(filePath)) {
    throw new Error(`Not a markdown file: ${filePath}`);
  }
  const storageDir = options.storageDir;
  const host = options.host ?? '127.0.0.1';
  const distDir = options.distDir ?? path.join(__dirname);
  const workspaceRoot = path.dirname(filePath);
  const clients = new Set<{ send: (data: string) => void; close: () => void }>();

  const wireFor = (doc?: PlainTextDocument) =>
    loadDoc(storageDir, filePath).threads.map((t) => toWire(t, doc));

  const postAll = (msg: HostToWebview) => {
    const raw = JSON.stringify(msg);
    for (const c of clients) c.send(raw);
  };

  const sendRender = () => {
    const text = readDocText(filePath);
    const doc = PlainTextDocument.fromString(text);
    postAll({
      type: 'render',
      text,
      threads: wireFor(doc),
      options: defaultRenderOptions(),
    });
  };

  const sendThreads = () => {
    const doc = PlainTextDocument.fromString(readDocText(filePath));
    postAll({ type: 'threads', threads: wireFor(doc) });
  };

  const mutate = (fn: (doc: StoredDocument) => void) => {
    const stored = loadDoc(storageDir, filePath);
    fn(stored);
    saveDoc(storageDir, filePath, stored);
    sendThreads();
  };

  const handleCreate = (selection: RenderedSelection, text: string) => {
    if (!text.trim()) return;
    const model = PlainTextDocument.fromString(readDocText(filePath));
    const range = mapRenderedSelectionToRange(model, selection);
    if (!range) return;
    const anchor = buildAnchorFromRange(model, range, 'selection');
    anchor.rendered = { quote: selection.quote, before: selection.before, after: selection.after };
    mutate((d) =>
      d.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
      }),
    );
  };

  const handleCreateBlock = (
    startLine: number,
    _endLine: number,
    label: string,
    target: 'mermaid-diagram',
    text: string,
  ) => {
    if (!text.trim()) return;
    const model = PlainTextDocument.fromString(readDocText(filePath));
    const safeStartLine = Math.min(Math.max(0, startLine), Math.max(0, model.lineCount - 1));
    const range = model.lineAt(safeStartLine).range;
    const anchor = buildAnchorFromRange(model, range, 'selection');
    anchor.rendered = { quote: label, before: '', after: '' };
    anchor.target = { kind: target };
    mutate((d) =>
      d.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
      }),
    );
  };

  const handleCreateNode = (startLine: number, label: string, nodeId: string, text: string) => {
    if (!text.trim()) return;
    const model = PlainTextDocument.fromString(readDocText(filePath));
    const safeStartLine = Math.min(Math.max(0, startLine), Math.max(0, model.lineCount - 1));
    const range = model.lineAt(safeStartLine).range;
    const anchor = buildAnchorFromRange(model, range, 'selection');
    anchor.rendered = { quote: label, before: '', after: '' };
    anchor.target = { kind: 'mermaid-node', nodeId };
    mutate((d) =>
      d.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
      }),
    );
  };

  const resolveResources = (sources: string[], port: number): ResolvedPreviewResource[] =>
    sources.map((source) => {
      if (/^https:/i.test(source) || /^data:image\//i.test(source)) {
        return { source, uri: source };
      }
      const resolved = resolveLocalFile(filePath, source, workspaceRoot);
      if (!resolved) {
        return { source, error: '不允许读取该资源路径' };
      }
      if (!fs.existsSync(resolved)) {
        return { source, error: '资源文件不存在' };
      }
      return {
        source,
        uri: `http://${host}:${port}/file?path=${encodeURIComponent(resolved)}`,
      };
    });

  const handleMessage = (msg: WebviewToHost, port: number) => {
    switch (msg.type) {
      case 'ready':
        sendRender();
        break;
      case 'createThread':
        handleCreate(msg.selection, msg.text);
        break;
      case 'createBlockThread':
        handleCreateBlock(msg.startLine, msg.endLine, msg.label, msg.target, msg.text);
        break;
      case 'createMermaidNodeThread':
        handleCreateNode(msg.startLine, msg.label, msg.nodeId, msg.text);
        break;
      case 'createDocThread':
        if (msg.text) {
          mutate((d) =>
            d.threads.push({
              id: randomUUID(),
              anchor: {
                kind: 'document',
                startLine: 0,
                startChar: 0,
                endLine: 0,
                endChar: 0,
                quote: '',
                before: '',
                after: '',
              },
              status: 'open',
              comments: [
                { id: randomUUID(), author: 'user', body: msg.text, createdAt: new Date().toISOString() },
              ],
            }),
          );
        }
        break;
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
            if (c) c.body = msg.text;
          });
        }
        break;
      case 'resolve':
        mutate((d) => {
          const t = d.threads.find((x) => x.id === msg.threadId);
          if (t) t.status = msg.resolved ? 'resolved' : 'open';
        });
        break;
      case 'deleteComment':
        mutate((d) => {
          const t = d.threads.find((x) => x.id === msg.threadId);
          if (t) t.comments = t.comments.filter((c) => c.id !== msg.commentId);
          d.threads = d.threads.filter((x) => x.comments.length > 0);
        });
        break;
      case 'deleteThread':
        mutate((d) => {
          d.threads = d.threads.filter((x) => x.id !== msg.threadId);
        });
        break;
      case 'revealSource':
      case 'revealSourceLine':
      case 'previewScroll':
        // no-op in browser preview (no editor to sync)
        break;
      case 'resolveResources':
        postAll({
          type: 'resolvedResources',
          requestId: msg.requestId,
          resources: resolveResources(msg.sources, port),
        });
        break;
      case 'openLink': {
        const href = msg.href.trim();
        if (!href || href.startsWith('#')) break;
        if (/^https?:/i.test(href) || /^mailto:/i.test(href)) {
          openExternal(href);
          break;
        }
        const resolved = resolveLocalFile(filePath, href, workspaceRoot);
        if (resolved) openExternal(resolved);
        break;
      }
      case 'openImage': {
        if (/^https:/i.test(msg.source)) {
          openExternal(msg.source);
          break;
        }
        const resolved = resolveLocalFile(filePath, msg.source, workspaceRoot);
        if (resolved) openExternal(resolved);
        break;
      }
      case 'copyImageFallback':
        // best-effort: no system clipboard API in node host; ignore
        break;
      default:
        break;
    }
  };

  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRender = () => {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(sendRender, RENDER_DEBOUNCE_MS);
  };

  let fileWatcher: fs.FSWatcher | undefined;
  try {
    fileWatcher = fs.watch(filePath, () => scheduleRender());
  } catch {
    // unsupported
  }

  const docsDir = path.join(storageDir, 'docs');
  const myHash = fileHash(filePath);
  let storageWatcher: fs.FSWatcher | undefined;
  let storageTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    fs.mkdirSync(docsDir, { recursive: true });
    storageWatcher = fs.watch(docsDir, (_event, filename) => {
      if (!filename || String(filename).replace(/\.json$/, '') !== myHash) return;
      if (storageTimer) clearTimeout(storageTimer);
      storageTimer = setTimeout(sendThreads, 120);
    });
  } catch {
    // ignore
  }

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = buildHtml(`评论预览：${path.basename(filePath)}`, filePath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      if (url.pathname === '/webview.js' || url.pathname === '/webview.css') {
        const asset = path.join(distDir, url.pathname.slice(1));
        if (!isInside(distDir, asset) || !fs.existsSync(asset)) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeFor(asset), 'Cache-Control': 'no-cache' });
        fs.createReadStream(asset).pipe(res);
        return;
      }
      if (url.pathname.startsWith('/assets/')) {
        const asset = path.join(distDir, url.pathname.slice(1));
        if (!isInside(distDir, asset) || !fs.existsSync(asset)) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeFor(asset), 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(asset).pipe(res);
        return;
      }
      if (url.pathname === '/file') {
        const target = url.searchParams.get('path') || '';
        const resolved = realPath(target);
        const roots = [path.dirname(filePath), workspaceRoot]
          .map((r) => realPath(r))
          .filter((r): r is string => !!r);
        if (!resolved || !roots.some((root) => isInside(root, resolved)) || !fs.existsSync(resolved)) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeFor(resolved) });
        fs.createReadStream(resolved).pipe(res);
        return;
      }
      res.writeHead(404).end('Not found');
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const client = acceptWebSocket(req, socket as import('node:net').Socket, head) as
      (WsClient & { onMessage: (cb: (data: string) => void) => void }) | null;
    if (!client) return;
    clients.add(client);
    client.onMessage((raw) => {
      try {
        const value = JSON.parse(raw) as unknown;
        if (!isWebviewMessage(value)) return;
        handleMessage(value, (server.address() as { port: number }).port);
      } catch {
        // ignore bad frames
      }
    });
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind preview server'));
        return;
      }
      resolve(addr.port);
    });
  });

  const url = `http://${host}:${port}/?file=${encodeURIComponent(filePath)}`;

  return {
    url,
    port,
    close: async () => {
      if (renderTimer) clearTimeout(renderTimer);
      if (storageTimer) clearTimeout(storageTimer);
      fileWatcher?.close();
      storageWatcher?.close();
      for (const c of clients) c.close();
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
