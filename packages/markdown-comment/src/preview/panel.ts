// Host 侧：WebviewPanel 生命周期 + postMessage 协议 + 文档重渲 + 评论增删改。
// host 独占 storage，webview 是纯视图：所有改动 webview→postMessage→host 写盘→host 推回。
// 注：webview 自身发起的改动会即时回推；源码侧/CLI/Agent 改 storage 后回灌 webview 留到 MW4。
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDoc, saveDoc, fileHash } from '../storage';
import { isMarkdownDocument } from '../markdown-lang';
import { buildAnchorFromRange, mapRenderedSelectionToRange, relocate } from '../anchor';
import type { StoredDocument, StoredThread } from '../types';
import type { HostToWebview, RenderedSelection, WebviewToHost, WireThread } from './messages';

const RENDER_DEBOUNCE_MS = 150;

interface PreviewController {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  dispose(): void;
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

// 拿源文档：优先用已打开的，否则后台 openTextDocument 加载（不显示标签页）。
// 关掉源码标签后预览仍能建评论/重渲；文件已删/读失败返回 undefined。
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

/**
 * StoredThread → webview 用的精简表示；返回 null 表示这条在当前文本里**不展示**。
 * 传入当前 doc 时对划词锚点做**读时** relocate：内容变动后高亮跟着原文走（不写回存储）。
 * relocate 失败（原文被完整删除/替换、全文都搜不到）→ 返回 null，预览里隐藏这条评论。
 * 数据仍留在 storage；若原文恢复，下次 relocate 成功会重新出现并定位。引用文本始终用冻结快照。
 */
function toWire(t: StoredThread, doc?: vscode.TextDocument): WireThread | null {
  let startLine = t.anchor.startLine;
  let endLine = t.anchor.endLine;
  if (doc && t.anchor.kind === 'selection') {
    const r = relocate(doc, t.anchor);
    if (!r) {
      return null; // 原文已删/被完整替换 → 预览里隐藏
    }
    startLine = r.start.line;
    endLine = r.end.line;
  }
  return {
    id: t.id,
    status: t.status,
    kind: t.anchor.kind,
    blockStartLine: startLine,
    blockEndLine: endLine + 1,
    quote: t.anchor.quote,
    rendered: t.anchor.rendered,
    comments: t.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt })),
  };
}

const STYLE = `
:root { color-scheme: light dark; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 14px);
  line-height: 1.7;
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
  display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
}
#mdc-tabs { display: flex; gap: 2px; min-width: 0; flex-wrap: wrap; }
.mdc-tab {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 0.82em; padding: 3px 9px; border: none; border-radius: 999px; cursor: pointer;
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
#mdc-add-doc {
  flex: none; font-size: 0.82em; padding: 4px 9px; border: none; border-radius: 4px; cursor: pointer;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, inherit);
}
#mdc-add-doc:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.3)); }
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

function buildHtml(webview: vscode.Webview, scriptUri: vscode.Uri, title: string): string {
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
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
      <button id="mdc-add-doc" title="对整篇文档添加评论">＋ 全文评论</button>
    </div>
    <div id="sidebar-draft"></div>
    <div id="sidebar-inner"></div>
  </aside>
</div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function openPreview(context: vscode.ExtensionContext, editor?: vscode.TextEditor): void {
  const ed = editor ?? vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== 'file' || !isMarkdownDocument(ed.document.languageId, ed.document.uri.fsPath)) {
    vscode.window.showInformationMessage('请在 Markdown 文件中打开评论预览');
    return;
  }
  const uri = ed.document.uri;
  const existing = previews.get(keyOf(uri));
  if (existing) {
    existing.panel.reveal();
    return;
  }

  const storageDir = context.globalStorageUri.fsPath;
  const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
  // 在当前编辑组内打开（与源 markdown 同窗口，作为相邻标签页），不再 split 到一侧。
  const panel = vscode.window.createWebviewPanel(
    'markdownCommentPreview',
    `评论预览：${path.basename(uri.fsPath)}`,
    vscode.ViewColumn.Active,
    // enableFindWidget：让 webview 支持 Cmd/Ctrl+F 唤起 VS Code 查找框，在渲染预览文本里搜索。
    { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: true, localResourceRoots: [distUri] },
  );
  const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
  panel.webview.html = buildHtml(panel.webview, scriptUri, panel.title);

  const post = (msg: HostToWebview) => void panel.webview.postMessage(msg);
  const wireFor = (doc?: vscode.TextDocument) =>
    loadDoc(storageDir, uri.fsPath)
      .threads.map((t) => toWire(t, doc))
      .filter((w): w is WireThread => w !== null);
  // 取当前文本来 relocate（源码 tab 没开则后台加载），保证回推 webview 的行号是最新的。
  const sendThreads = async () => post({ type: 'threads', threads: wireFor(await getDoc(uri)) });
  const sendRender = async () => {
    const doc = await getDoc(uri);
    post({ type: 'render', text: doc?.getText() ?? '', threads: wireFor(doc) });
  };

  // 改 storage 后即时回推 webview（源码侧由 fs.watch 自行重载）。
  const mutate = (fn: (doc: StoredDocument) => void) => {
    const stored = loadDoc(storageDir, uri.fsPath);
    fn(stored);
    saveDoc(storageDir, uri.fsPath, stored);
    void sendThreads();
  };

  const handleCreate = async (selection: RenderedSelection, text: string) => {
    if (!text.trim()) {
      return;
    }
    const doc = await getDoc(uri);
    if (!doc) {
      vscode.window.showWarningMessage('源 Markdown 文件无法读取（可能已删除或移动），无法创建评论');
      return;
    }
    const range = mapRenderedSelectionToRange(doc, selection);
    if (!range) {
      vscode.window.showWarningMessage('无法把这段选区定位回源码');
      return;
    }
    const anchor = buildAnchorFromRange(doc, range, 'selection');
    // 存渲染态选区：即便源码锚点退回整块，webview 仍能精确高亮用户当时所选。
    anchor.rendered = { quote: selection.quote, before: selection.before, after: selection.after };
    const thread: StoredThread = {
      id: randomUUID(),
      anchor,
      status: 'open',
      comments: [{ id: randomUUID(), author: 'user', body: text, createdAt: new Date().toISOString() }],
    };
    mutate((d) => d.threads.push(thread));
  };

  const revealSource = async (threadId: string) => {
    const t = loadDoc(storageDir, uri.fsPath).threads.find((x) => x.id === threadId);
    if (!t) {
      return;
    }
    const doc = await getDoc(uri);
    if (!doc) {
      vscode.window.showWarningMessage('源 Markdown 文件无法读取（可能已删除或移动）');
      return;
    }
    // 全文评论：只打开文档，不定位到某一行。
    if (t.anchor.kind === 'document') {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
      return;
    }
    const range = relocate(doc, t.anchor) ?? new vscode.Range(0, 0, 0, 0);
    const shown = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    shown.selection = new vscode.Selection(range.start, range.end);
    shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRender = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void sendRender(), RENDER_DEBOUNCE_MS);
  };

  const subs: vscode.Disposable[] = [
    panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      switch (msg.type) {
        case 'ready':
          void sendRender();
          break;
        case 'createThread':
          void handleCreate(msg.selection, msg.text);
          break;
        case 'createDocThread':
          if (msg.text) {
            mutate((d) =>
              d.threads.push({
                id: randomUUID(),
                anchor: { kind: 'document', startLine: 0, startChar: 0, endLine: 0, endChar: 0, quote: '', before: '', after: '' },
                status: 'open',
                comments: [{ id: randomUUID(), author: 'user', body: msg.text, createdAt: new Date().toISOString() }],
              }),
            );
          }
          break;
        case 'reply':
          mutate((d) => {
            const t = d.threads.find((x) => x.id === msg.threadId);
            if (t) {
              t.comments.push({ id: randomUUID(), author: 'user', body: msg.text, createdAt: new Date().toISOString() });
            }
          });
          break;
        case 'editComment':
          if (msg.text.trim()) {
            mutate((d) => {
              const c = d.threads.find((x) => x.id === msg.threadId)?.comments.find((y) => y.id === msg.commentId);
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
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (keyOf(e.document.uri) === keyOf(uri)) {
        scheduleRender();
      }
    }),
  ];

  // 监听本文档的 storage 文件：源码侧 / CLI / Agent 改了评论 → 回灌 webview。
  // 不区分写入方（含本预览自身的写），重复 sendThreads 是幂等的。
  const docsDir = path.join(storageDir, 'docs');
  const myHash = fileHash(uri.fsPath);
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
      watchTimer = setTimeout(sendThreads, 120);
    });
  } catch {
    // 平台/文件系统不支持 fs.watch：外部改动不自动回灌，webview 自身改动仍即时刷新。
  }

  const controller: PreviewController = {
    panel,
    uri,
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
  previews.set(keyOf(uri), controller);
  panel.onDidDispose(() => {
    controller.dispose();
    previews.delete(keyOf(uri));
  });
}
