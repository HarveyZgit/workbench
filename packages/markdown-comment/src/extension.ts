import * as vscode from 'vscode';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writePointer, loadDoc, saveDoc, fileHash } from './storage';
import { isMarkdownDocument } from './markdown-lang';
import type { StoredAnchor, StoredComment, StoredThread } from './types';
import { buildAnchorFromRange, relocate } from './anchor';
import { openPreview } from './preview/panel';

const CONTROLLER_ID = 'markdownComment';
const AUTHOR_USER = 'user';
const PERSIST_DEBOUNCE_MS = 250;

/** 我们自己的 Comment 实现，额外携带 id / parent / 持久化字段。 */
class MarkdownComment implements vscode.Comment {
  contextValue?: string;
  timestamp?: Date;
  savedBody: string;

  constructor(
    public id: string,
    public body: vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent: vscode.CommentThread,
    public storedAuthor: string,
    public createdAt: string,
  ) {
    this.savedBody = body.value;
    this.contextValue = storedAuthor;
    this.timestamp = new Date(createdAt);
  }
}

interface ThreadMeta {
  id: string;
  kind: 'selection' | 'document';
  status: 'open' | 'resolved';
}

let controller: vscode.CommentController;
let storageDir = '';
let highlightDecoration: vscode.TextEditorDecorationType;
let watcher: fs.FSWatcher | undefined;

const threadMeta = new WeakMap<vscode.CommentThread, ThreadMeta>();
const docThreads = new Map<string, Set<vscode.CommentThread>>();
const loadedDocs = new Set<string>();
const pendingPersist = new Map<string, ReturnType<typeof setTimeout>>();
/** fileHash → 最近一次插件自身写入的时间戳，用来在 fs.watch 回调里忽略自己的写入，避免自激刷新。 */
const recentSelfWrite = new Map<string, number>();

const keyOf = (uri: vscode.Uri) => uri.toString();

/** 源码内联（行）评论开关，默认关闭。关闭时只走渲染预览评论；源码侧不渲染、不提供 + 号、不写盘。 */
function sourceCommentsEnabled(): boolean {
  return vscode.workspace.getConfiguration('markdownComment').get<boolean>('sourceComments.enabled', false);
}

function trackThread(uri: vscode.Uri, thread: vscode.CommentThread): void {
  const k = keyOf(uri);
  let set = docThreads.get(k);
  if (!set) {
    set = new Set();
    docThreads.set(k, set);
  }
  set.add(thread);
}

function untrackThread(uri: vscode.Uri, thread: vscode.CommentThread): void {
  docThreads.get(keyOf(uri))?.delete(thread);
}

function authorInfo(storedAuthor: string): vscode.CommentAuthorInformation {
  if (storedAuthor === 'agent') {
    return { name: '🤖 Agent' };
  }
  let name = 'You';
  try {
    name = os.userInfo().username || name;
  } catch {
    // 拿不到用户名，用默认值。
  }
  return { name };
}

// ─── 锚点：序列化 ───────────────────────────────────────────────────

function buildAnchor(doc: vscode.TextDocument, thread: vscode.CommentThread, meta: ThreadMeta): StoredAnchor {
  const range = thread.range;
  if (meta.kind === 'document' || !range) {
    return buildAnchorFromRange(doc, new vscode.Range(0, 0, 0, 0), 'document');
  }
  return buildAnchorFromRange(doc, range, 'selection');
}

function applyThreadState(thread: vscode.CommentThread, meta: ThreadMeta): void {
  if (meta.status === 'resolved') {
    thread.state = vscode.CommentThreadState.Resolved;
    thread.contextValue = 'resolved';
  } else {
    thread.state = vscode.CommentThreadState.Unresolved;
    thread.contextValue = 'unresolved';
  }
}

/** 线程头部文字：划词评论显示被选中的原文摘要，让你一眼知道评论锚在哪。 */
function labelFor(kind: 'selection' | 'document', quote: string, anchorFailed: boolean): string {
  if (anchorFailed) {
    return '⚠ 原文已变更（锚点失效）';
  }
  if (kind === 'document') {
    return '全文评论';
  }
  const q = quote.trim().replace(/\s+/g, ' ');
  const short = q.length > 30 ? q.slice(0, 30) + '…' : q;
  return short ? `评论：「${short}」` : '评论';
}

// ─── 划词高亮 ──────────────────────────────────────────────────────

function updateDecorations(uri: vscode.Uri): void {
  const editors = vscode.window.visibleTextEditors.filter((e) => keyOf(e.document.uri) === keyOf(uri));
  if (editors.length === 0) {
    return;
  }
  const ranges: vscode.Range[] = [];
  const set = docThreads.get(keyOf(uri));
  if (set) {
    for (const thread of set) {
      const meta = threadMeta.get(thread);
      if (meta?.kind === 'selection' && meta.status !== 'resolved' && thread.range) {
        ranges.push(thread.range);
      }
    }
  }
  for (const editor of editors) {
    editor.setDecorations(highlightDecoration, ranges);
  }
}

// ─── 加载 / 持久化 ─────────────────────────────────────────────────

function toMarkdownComment(sc: StoredComment, thread: vscode.CommentThread): MarkdownComment {
  return new MarkdownComment(
    sc.id,
    new vscode.MarkdownString(sc.body),
    vscode.CommentMode.Preview,
    authorInfo(sc.author),
    thread,
    sc.author,
    sc.createdAt,
  );
}

function loadForDocument(doc: vscode.TextDocument): void {
  // 关闭源码内联评论：不在源码编辑器里渲染已有评论（也就不会标记 loaded / 不会写盘）。
  if (!sourceCommentsEnabled() || doc.uri.scheme !== 'file' || !isMarkdownDocument(doc.languageId, doc.uri.fsPath)) {
    return;
  }
  const k = keyOf(doc.uri);
  if (loadedDocs.has(k)) {
    return;
  }
  loadedDocs.add(k);

  for (const st of loadDoc(storageDir, doc.uri.fsPath).threads) {
    const located = relocate(doc, st.anchor);
    const range = located ?? new vscode.Range(0, 0, 0, 0);
    const thread = controller.createCommentThread(doc.uri, range, []);
    const meta: ThreadMeta = { id: st.id, kind: st.anchor.kind, status: st.status };
    threadMeta.set(thread, meta);
    thread.comments = st.comments.map((sc) => toMarkdownComment(sc, thread));
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    applyThreadState(thread, meta);
    thread.label = labelFor(meta.kind, st.anchor.quote, located === null);
    trackThread(doc.uri, thread);
  }
  updateDecorations(doc.uri);
}

function serialize(doc: vscode.TextDocument): StoredThread[] {
  const set = docThreads.get(keyOf(doc.uri));
  const threads: StoredThread[] = [];
  if (!set) {
    return threads;
  }
  for (const thread of set) {
    const meta = threadMeta.get(thread);
    if (!meta) {
      continue;
    }
    const comments: StoredComment[] = (thread.comments as readonly MarkdownComment[]).map((c) => ({
      id: c.id,
      author: c.storedAuthor,
      body: typeof c.body === 'string' ? c.body : c.body.value,
      createdAt: c.createdAt,
    }));
    if (comments.length === 0) {
      continue;
    }
    threads.push({ id: meta.id, anchor: buildAnchor(doc, thread, meta), status: meta.status, comments });
  }
  return threads;
}

function persistNow(uri: vscode.Uri): void {
  if (uri.scheme !== 'file') {
    return;
  }
  const doc = vscode.workspace.textDocuments.find((d) => keyOf(d.uri) === keyOf(uri));
  if (!doc) {
    return;
  }
  recentSelfWrite.set(fileHash(doc.uri.fsPath), Date.now());
  saveDoc(storageDir, doc.uri.fsPath, { version: 1, threads: serialize(doc) });
}

/** 防抖持久化：高频操作（输入、连续编辑）合并成一次磁盘写，避免同步写阻塞 UI。 */
function schedulePersist(uri: vscode.Uri): void {
  const k = keyOf(uri);
  const existing = pendingPersist.get(k);
  if (existing) {
    clearTimeout(existing);
  }
  pendingPersist.set(
    k,
    setTimeout(() => {
      pendingPersist.delete(k);
      persistNow(uri);
    }, PERSIST_DEBOUNCE_MS),
  );
}

// ─── 自动刷新（Agent 通过 CLI 改了存储 → 重新加载 UI）──────────────

function reloadDocument(fsPath: string): void {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === fsPath);
  if (!doc) {
    return;
  }
  const set = docThreads.get(keyOf(doc.uri));
  if (set) {
    for (const thread of set) {
      thread.dispose();
    }
    set.clear();
  }
  loadedDocs.delete(keyOf(doc.uri));
  loadForDocument(doc);
}

function startWatch(context: vscode.ExtensionContext): void {
  const dir = path.join(storageDir, 'docs');
  fs.mkdirSync(dir, { recursive: true });
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (!filename) {
        return;
      }
      const hash = String(filename).replace(/\.json$/, '');
      if (Date.now() - (recentSelfWrite.get(hash) || 0) < 1500) {
        return; // 这是插件自己刚写的，跳过。
      }
      for (const d of vscode.workspace.textDocuments) {
        if (d.uri.scheme === 'file' && fileHash(d.uri.fsPath) === hash) {
          reloadDocument(d.uri.fsPath);
        }
      }
    });
    context.subscriptions.push({ dispose: () => watcher?.close() });
  } catch {
    // 某些平台/文件系统不支持 fs.watch，自动刷新降级为不可用，不影响其余功能。
  }
}

// ─── 命令 ──────────────────────────────────────────────────────────

function startThread(kind: 'selection' | 'document'): void {
  if (!sourceCommentsEnabled()) {
    vscode.window.showInformationMessage(
      '源码内联评论已关闭。可在设置开启 markdownComment.sourceComments.enabled，或用「打开评论预览」在渲染视图里评论。',
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownDocument(editor.document.languageId, editor.document.uri.fsPath)) {
    vscode.window.showInformationMessage('请在 Markdown 文件中操作');
    return;
  }
  loadForDocument(editor.document);

  let range: vscode.Range;
  if (kind === 'document') {
    range = new vscode.Range(0, 0, 0, 0);
  } else if (editor.selection.isEmpty) {
    range = editor.document.lineAt(editor.selection.active.line).range;
  } else {
    range = new vscode.Range(editor.selection.start, editor.selection.end);
  }

  const thread = controller.createCommentThread(editor.document.uri, range, []);
  const meta: ThreadMeta = { id: randomUUID(), kind, status: 'open' };
  threadMeta.set(thread, meta);
  thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  applyThreadState(thread, meta);
  thread.label = labelFor(kind, kind === 'selection' ? editor.document.getText(range) : '', false);
  trackThread(editor.document.uri, thread);
}

function addReply(reply: vscode.CommentReply): void {
  const thread = reply.thread;
  if (!threadMeta.has(thread)) {
    const meta: ThreadMeta = { id: randomUUID(), kind: 'selection', status: 'open' };
    threadMeta.set(thread, meta);
    applyThreadState(thread, meta);
    const srcDoc = vscode.workspace.textDocuments.find((d) => keyOf(d.uri) === keyOf(thread.uri));
    thread.label = labelFor('selection', srcDoc && thread.range ? srcDoc.getText(thread.range) : '', false);
    trackThread(thread.uri, thread);
  }
  const comment = new MarkdownComment(
    randomUUID(),
    new vscode.MarkdownString(reply.text),
    vscode.CommentMode.Preview,
    authorInfo(AUTHOR_USER),
    thread,
    AUTHOR_USER,
    new Date().toISOString(),
  );
  thread.comments = [...thread.comments, comment];
  thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  updateDecorations(thread.uri);
  schedulePersist(thread.uri);
}

function setResolved(thread: vscode.CommentThread, resolved: boolean): void {
  const meta = threadMeta.get(thread);
  if (meta) {
    meta.status = resolved ? 'resolved' : 'open';
    applyThreadState(thread, meta);
  }
  updateDecorations(thread.uri);
  schedulePersist(thread.uri);
}

function editComment(comment: MarkdownComment): void {
  comment.parent.comments = comment.parent.comments.map((c) => {
    if (c === comment) {
      (c as MarkdownComment).mode = vscode.CommentMode.Editing;
    }
    return c;
  });
}

function saveEdit(comment: MarkdownComment): void {
  const thread = comment.parent;
  thread.comments = thread.comments.map((c) => {
    if (c === comment) {
      const m = c as MarkdownComment;
      m.savedBody = typeof m.body === 'string' ? m.body : m.body.value;
      m.mode = vscode.CommentMode.Preview;
    }
    return c;
  });
  schedulePersist(thread.uri);
}

function cancelEdit(comment: MarkdownComment): void {
  comment.parent.comments = comment.parent.comments.map((c) => {
    if (c === comment) {
      const m = c as MarkdownComment;
      m.body = new vscode.MarkdownString(m.savedBody);
      m.mode = vscode.CommentMode.Preview;
    }
    return c;
  });
}

function deleteComment(comment: MarkdownComment): void {
  const thread = comment.parent;
  thread.comments = thread.comments.filter((c) => c !== comment);
  if (thread.comments.length === 0) {
    const uri = thread.uri;
    untrackThread(uri, thread);
    threadMeta.delete(thread);
    thread.dispose();
    updateDecorations(uri);
    schedulePersist(uri);
  } else {
    schedulePersist(thread.uri);
  }
}

function deleteThread(thread: vscode.CommentThread): void {
  const uri = thread.uri;
  untrackThread(uri, thread);
  threadMeta.delete(thread);
  thread.dispose();
  updateDecorations(uri);
  schedulePersist(uri);
}

// ─── 激活 ──────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  storageDir = context.globalStorageUri.fsPath;
  fs.mkdirSync(storageDir, { recursive: true });
  writePointer(storageDir);

  controller = vscode.comments.createCommentController(CONTROLLER_ID, 'Markdown 评论');
  controller.options = {
    prompt: '评论',
    placeHolder: '写下你的评论…',
  };
  controller.commentingRangeProvider = {
    provideCommentingRanges(document) {
      if (!sourceCommentsEnabled() || document.uri.scheme !== 'file' || !isMarkdownDocument(document.languageId, document.uri.fsPath)) {
        return [];
      }
      return [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
    },
  };
  context.subscriptions.push(controller);

  highlightDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 209, 102, 0.28)',
    borderRadius: '2px',
    overviewRulerColor: 'rgba(255, 199, 89, 0.9)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  context.subscriptions.push(highlightDecoration);

  startWatch(context);

  for (const doc of vscode.workspace.textDocuments) {
    loadForDocument(doc);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => loadForDocument(doc)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        loadForDocument(editor.document);
        updateDecorations(editor.document.uri);
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        updateDecorations(editor.document.uri);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      // 只有带评论的文档才需要随编辑更新高亮位置与持久化锚点。
      if (docThreads.get(keyOf(e.document.uri))?.size) {
        updateDecorations(e.document.uri);
        schedulePersist(e.document.uri);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // 源码内联评论开关切换：提示重载，避免「已渲染线程未拆 / 新开关未挂」的半开状态。
      if (e.affectsConfiguration('markdownComment.sourceComments.enabled')) {
        void vscode.window
          .showInformationMessage('Markdown 评论：源码内联评论开关已更改，重载窗口后生效。', '重载窗口')
          .then((pick) => {
            if (pick === '重载窗口') {
              void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
      }
    }),
  );

  const register = (id: string, handler: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register('markdownComment.addComment', () => startThread('selection'));
  register('markdownComment.addDocumentComment', () => startThread('document'));
  register('markdownComment.openPreview', () => openPreview(context));
  register('markdownComment.createThread', (reply: vscode.CommentReply) => addReply(reply));
  register('markdownComment.reply', (reply: vscode.CommentReply) => addReply(reply));
  register('markdownComment.resolve', (thread: vscode.CommentThread) => setResolved(thread, true));
  register('markdownComment.reopen', (thread: vscode.CommentThread) => setResolved(thread, false));
  register('markdownComment.editComment', (comment: MarkdownComment) => editComment(comment));
  register('markdownComment.saveEdit', (comment: MarkdownComment) => saveEdit(comment));
  register('markdownComment.cancelEdit', (comment: MarkdownComment) => cancelEdit(comment));
  register('markdownComment.deleteComment', (comment: MarkdownComment) => deleteComment(comment));
  register('markdownComment.deleteThread', (thread: vscode.CommentThread) => deleteThread(thread));
}

export function deactivate(): void {
  // 退出前把还在防抖队列里的写入立即落盘。
  for (const [k, timer] of pendingPersist) {
    clearTimeout(timer);
    persistNow(vscode.Uri.parse(k));
  }
  pendingPersist.clear();
}
