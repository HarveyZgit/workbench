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
import { isCommentableMarkdown, isMarkdownDocument } from '../markdown-lang';
import { relocate } from '../anchor';
import { computePreviewLineChanges } from './diff';
import { findHeadingLine } from './heading';
import { applyCommentMutation } from './comment-ops';
import { isWebviewMessage } from './protocol';
import { buildPreviewHtml } from './shell';
import { mermaidBlockNear, toWire } from './threads';
import type {
  HostToWebview,
  PreviewLineChanges,
  PreviewRenderOptions,
  ResolvedPreviewResource,
  WebviewToHost,
} from './messages';

const RENDER_DEBOUNCE_MS = 150;
const MAX_LINK_LENGTH = 4_096;
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
  return vscode.workspace.textDocuments.find((d) => keyOf(d.uri) === keyOf(uri));
}

function renderOptions(
  webview: vscode.Webview,
  uri: vscode.Uri,
  _doc?: vscode.TextDocument,
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
    styles: resolvePreviewStyles(webview, uri, config.get<string[]>('styles', [])),
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

function localResourceRoots(context: vscode.ExtensionContext, uri: vscode.Uri): vscode.Uri[] {
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'dist'),
    // untitled 无磁盘目录：跳过 dirname(fsPath)，相对本地图在未保存时不可解析。
    ...(uri.scheme === 'file' ? [vscode.Uri.file(path.dirname(uri.fsPath))] : []),
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

function allowedFileRoots(uri: vscode.Uri): string[] {
  return [
    ...(uri.scheme === 'file' ? [path.dirname(uri.fsPath)] : []),
    ...(vscode.workspace.workspaceFolders
      ?.filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => folder.uri.fsPath) ?? []),
  ];
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
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  // untitled：没有可靠的磁盘 dirname，相对路径本地资源直接放弃（https / data 仍由调用方放行）。
  if (uri.scheme !== 'file' && !decodedPath.startsWith('/')) {
    return null;
  }
  const absolutePath = decodedPath.startsWith('/')
    ? workspaceFolder
      ? path.resolve(workspaceFolder.uri.fsPath, `.${decodedPath}`)
      : decodedPath
    : path.resolve(path.dirname(uri.fsPath), decodedPath);
  const resolvedRealPath = realPath(absolutePath);
  if (
    !resolvedRealPath ||
    !allowedFileRoots(uri).some((root) => {
      const rootRealPath = realPath(root);
      return rootRealPath !== null && isInside(rootRealPath, resolvedRealPath);
    })
  ) {
    return null;
  }
  return vscode.Uri.file(resolvedRealPath).with({
    query: reference.suffix.startsWith('?') ? reference.suffix.slice(1).split('#')[0] : '',
    fragment: reference.suffix.includes('#') ? reference.suffix.slice(reference.suffix.indexOf('#') + 1) : '',
  });
}

function resolvePreviewStyles(webview: vscode.Webview, uri: vscode.Uri, sources: string[]): string[] {
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
      const { size } = fs.statSync(resolved.fsPath);
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

function readLineChanges(absPath: string, current: string): PreviewLineChanges | undefined {
  if (
    current.length > MAX_DIFF_DOCUMENT_SIZE ||
    current.split(/\r?\n/, MAX_DIFF_DOCUMENT_LINES + 1).length > MAX_DIFF_DOCUMENT_LINES
  ) {
    return undefined;
  }
  try {
    const baseline = fs.readFileSync(absPath, 'utf8');
    if (
      baseline.length > MAX_DIFF_DOCUMENT_SIZE ||
      baseline.split(/\r?\n/, MAX_DIFF_DOCUMENT_LINES + 1).length > MAX_DIFF_DOCUMENT_LINES
    ) {
      return undefined;
    }
    return computePreviewLineChanges(baseline, current);
  } catch {
    return undefined;
  }
}

// 拿源文档：优先用已打开的，否则后台 openTextDocument 加载（不显示标签页）。
async function getDoc(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const open = docFor(uri);
  if (open) {
    return open;
  }
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

function lineForFragment(doc: vscode.TextDocument, fragment: string): number | null {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // 无法解码时继续使用原 fragment。
  }
  return findHeadingLine(doc.getText(), decoded);
}

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
  return buildPreviewHtml({
    title,
    scriptUri: scriptUri.toString(),
    styleUri: styleUri.toString(),
    csp,
    nonce: n,
  });
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

export function hasPreview(uri: vscode.Uri): boolean {
  return previews.has(keyOf(uri));
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
  if (!ed || !isCommentableMarkdown(ed.document.languageId, ed.document.uri)) {
    vscode.window.showInformationMessage('请在 Markdown 文件中打开评论预览');
    return;
  }
  const { uri } = ed.document;
  const existing = previews.get(keyOf(uri));
  if (existing) {
    existing.panel.reveal();
    return;
  }

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
  const wireFor = (doc?: vscode.TextDocument) =>
    loadDoc(storageDir, docKey()).threads.map((t) => toWire(t, doc));
  // 取当前文本来 relocate（源码 tab 没开则后台加载），保证回推 webview 的行号是最新的。
  const sendThreads = async () => post({ type: 'threads', threads: wireFor(await getDoc(boundUri)) });
  const sendSkillPromptTarget = () => {
    const state = skillPromptStateFor(storageDir, boundUri);
    post({ type: 'skillPromptTarget', enabled: state.enabled, tip: state.tip });
  };
  const sendRender = async () => {
    const doc = await getDoc(boundUri);
    const text = doc?.getText() ?? '';
    const options = renderOptions(panel.webview, boundUri, doc);
    const encoding =
      doc &&
      'encoding' in doc &&
      typeof (doc as vscode.TextDocument & { encoding?: unknown }).encoding === 'string'
        ? (doc as vscode.TextDocument & { encoding: string }).encoding.toLowerCase()
        : 'utf8';
    const changes =
      options.renderedDiff && doc?.isDirty && encoding === 'utf8'
        ? boundUri.scheme === 'file'
          ? readLineChanges(boundUri.fsPath, text)
          : undefined
        : undefined;
    post({
      type: 'render',
      text,
      threads: wireFor(doc),
      options,
      diff: changes ? { baseline: 'saved', changes } : undefined,
    });
  };

  // 改 storage 后即时回推 webview（源码侧由 fs.watch 自行重载）。
  const applyMutation = async (msg: WebviewToHost) => {
    const doc = await getDoc(boundUri);
    const stored = loadDoc(storageDir, docKey());
    const result = applyCommentMutation(stored, doc?.getText() ?? '', msg);
    if (result.warning) {
      vscode.window.showWarningMessage(result.warning);
    }
    if (!result.changed) {
      return;
    }
    saveDoc(storageDir, docKey(), stored);
    void sendThreads();
    sendSkillPromptTarget();
  };

  const resolveResources = (sources: string[]): ResolvedPreviewResource[] =>
    sources.map((source) => {
      if (/^https:/i.test(source) || /^data:image\//i.test(source)) {
        return { source, uri: source };
      }
      const resolved = resolveLocalReference(boundUri, source);
      if (!resolved) {
        return { source, error: '不允许读取该资源路径' };
      }
      if (!fs.existsSync(resolved.fsPath)) {
        return { source, error: '资源文件不存在' };
      }
      return { source, uri: panel.webview.asWebviewUri(resolved).toString(true) };
    });

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
      vscode.window.showWarningMessage('源 Markdown 文件无法读取（可能已删除或移动）');
      return;
    }
    // 全文评论：只打开文档，不定位到某一行。
    if (t.anchor.kind === 'document') {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
      return;
    }
    const located = relocate(doc, t.anchor);
    const range = located
      ? new vscode.Range(located.start.line, located.start.character, located.end.line, located.end.character)
      : t.anchor.target?.kind === 'mermaid-node'
        ? (() => {
            const block = mermaidBlockNear(doc, t.anchor.startLine);
            return block ? doc.lineAt(block.startLine).range : new vscode.Range(0, 0, 0, 0);
          })()
        : new vscode.Range(0, 0, 0, 0);
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
        return;
      }
      const msg = value;
      switch (msg.type) {
        case 'ready':
          void sendRender();
          sendSkillPromptTarget();
          break;
        case 'createThread':
        case 'createBlockThread':
        case 'createMermaidNodeThread':
        case 'createDocThread':
        case 'reply':
        case 'editComment':
        case 'resolve':
        case 'deleteComment':
        case 'deleteThread':
          void applyMutation(msg);
          break;
        case 'revealSource':
          void revealSource(msg.threadId);
          break;
        case 'resolveResources':
          post({
            type: 'resolvedResources',
            requestId: msg.requestId,
            resources: resolveResources(msg.sources),
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
          const editor = vscode.window.visibleTextEditors.find(
            (candidate) => keyOf(candidate.document.uri) === keyOf(boundUri),
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
      if (keyOf(e.document.uri) === keyOf(boundUri)) {
        scheduleRender();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (keyOf(doc.uri) === keyOf(boundUri)) {
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
        keyOf(e.textEditor.document.uri) !== keyOf(boundUri) ||
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
