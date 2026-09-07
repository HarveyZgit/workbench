// 跑在 webview iframe 里：markdown-it 渲染 + data-line 标注 + 划词建评论 +
// 高亮 + 右侧边栏评论 UI + 正文↔边栏联动。host 独占数据，这里只发意图、画视图。
import './webview.css';
import { createMarkdownRenderer } from './markdown';
import { createOutlineUi } from './outline-ui';
import { createMermaidRuntime, type MermaidCommentIntent, type MermaidViewStates } from './mermaid';
import type {
  HostToWebview,
  PreviewLineChanges,
  PreviewRenderOptions,
  RenderedSelection,
  WebviewToHost,
  WireThread,
} from './messages';
import { createPreviewNavigation, type PreviewNavigation, type PreviewNavigationState } from './navigation';

const CONTEXT_LEN = 40;
const RESOURCE_BATCH_SIZE = 100;

const vscode = acquireVsCodeApi();
const markdownRenderer = createMarkdownRenderer();

function post(msg: WebviewToHost): void {
  vscode.postMessage(msg);
}

const content = document.getElementById('content');
const sidebar = document.getElementById('sidebar-inner');
const draftEl = document.getElementById('sidebar-draft');
const app = document.getElementById('app');
const toggleSidebarBtn = document.getElementById('mdc-toggle-sidebar');
const outlineTreeEl = document.getElementById('outline-tree');
const toggleOutlineBtn = document.getElementById('mdc-toggle-outline');

const submitKey = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl';

let lastText = '';
let lastThreads: WireThread[] = [];
let renderOptions: PreviewRenderOptions = {
  frontMatter: 'table',
  scrollPreviewWithEditor: true,
  scrollEditorWithPreview: true,
  doubleClickToSwitchToEditor: false,
  styles: [],
  fontSize: 14,
  lineHeight: 1.7,
  breaks: false,
  typographer: false,
  html: 'strict',
  renderedDiff: true,
  mermaidNodeComments: false,
};
let navigation: PreviewNavigation | undefined;
let renderGeneration = 0;
let resourceRequestGeneration = 0;
const pendingResourceRequests = new Set<string>();
let pendingMermaidComment: MermaidCommentIntent | undefined;

const mermaidRuntime = createMermaidRuntime({
  onComment(intent) {
    pendingMermaidComment = intent;
    renderBlockDraft(intent.label);
  },
});

const customStyleLinks = new Map<string, HTMLLinkElement>();

function applyPreviewAppearance(options: PreviewRenderOptions): void {
  document.documentElement.style.setProperty('--mdc-preview-font-size', `${options.fontSize}px`);
  document.documentElement.style.setProperty('--mdc-preview-line-height', String(options.lineHeight));
  if (options.fontFamily) {
    document.documentElement.style.setProperty('--mdc-preview-font-family', options.fontFamily);
  } else {
    document.documentElement.style.removeProperty('--mdc-preview-font-family');
  }
  const nextStyles = new Set(options.styles);
  for (const [uri, link] of customStyleLinks) {
    if (!nextStyles.has(uri)) {
      link.remove();
      customStyleLinks.delete(uri);
    }
  }
  for (const uri of nextStyles) {
    if (customStyleLinks.has(uri)) {
      continue;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = uri;
    link.dataset.mdcCustomStyle = 'true';
    document.head.append(link);
    customStyleLinks.set(uri, link);
  }
}

// ─── 小工具 ─────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}
function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
function authorName(author: string): string {
  return author === 'agent' ? '🤖 Agent' : '你';
}
const pad = (n: number) => String(n).padStart(2, '0');
/** 友好相对时间：<1分→1分钟内；<1时→x分钟前；<1天→x小时前；<1年→MM月DD日 HH:mm；否则带年份。 */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return '';
  }
  const d = new Date(t);
  const diffMin = (Date.now() - t) / 60000;
  if (diffMin < 1) {
    return '1 分钟内';
  }
  if (diffMin < 60) {
    return `${Math.floor(diffMin)} 分钟前`;
  }
  if (diffMin < 60 * 24) {
    return `${Math.floor(diffMin / 60)} 小时前`;
  }
  const md = `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return diffMin < 60 * 24 * 365 ? md : `${d.getFullYear()}年${md}`;
}

// 内联 SVG 图标（currentColor，随主题）。
const ICON_SOURCE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L2.5 8 6 12"/><path d="M10 4l3.5 4-3.5 4"/></svg>';
const ICON_RESOLVE =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/></svg>';
const ICON_DELETE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8"/></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4v2.2a2 2 0 0 1-2 2H4"/><path d="M6.3 6.3L4 8.2l2.3 1.9"/></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/><path d="M9.5 4l2.5 2.5"/></svg>';
const ICON_SIDEBAR_COLLAPSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
const ICON_SIDEBAR_EXPAND =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4l-4 4 4 4"/></svg>';

interface WebviewState {
  sidebarCollapsed?: boolean;
  outlineCollapsed?: boolean;
  /** Heading ids whose children are collapsed in the outline tree. */
  outlineCollapsedIds?: string[];
}

function readWebviewState(): WebviewState {
  const raw = vscode.getState();
  return raw && typeof raw === 'object' ? (raw as WebviewState) : {};
}

function setSidebarCollapsed(collapsed: boolean, persist = true): void {
  app?.classList.toggle('sidebar-collapsed', collapsed);
  if (toggleSidebarBtn) {
    const label = collapsed ? '展开侧边栏' : '收起侧边栏';
    toggleSidebarBtn.setAttribute('data-tip', label);
    toggleSidebarBtn.setAttribute('aria-label', label);
    toggleSidebarBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleSidebarBtn.innerHTML = collapsed ? ICON_SIDEBAR_EXPAND : ICON_SIDEBAR_COLLAPSE;
  }
  if (persist) {
    vscode.setState({ ...readWebviewState(), sidebarCollapsed: collapsed });
  }
}

function expandSidebar(): void {
  if (app?.classList.contains('sidebar-collapsed')) {
    setSidebarCollapsed(false);
  }
}

setSidebarCollapsed(readWebviewState().sidebarCollapsed === true, false);
toggleSidebarBtn?.addEventListener('click', () => {
  setSidebarCollapsed(!app?.classList.contains('sidebar-collapsed'));
});

function persistWebviewState(patch: Partial<WebviewState>): void {
  vscode.setState({ ...readWebviewState(), ...patch });
}

const outlineUi = createOutlineUi({
  app,
  content,
  outlineTree: outlineTreeEl,
  toggleBtn: toggleOutlineBtn,
  getCollapsed: () => readWebviewState().outlineCollapsed === true,
  setCollapsedPersist: (collapsed) => persistWebviewState({ outlineCollapsed: collapsed }),
  getCollapsedIds: () => {
    const ids = readWebviewState().outlineCollapsedIds;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  },
  setCollapsedIds: (ids) => persistWebviewState({ outlineCollapsedIds: [...ids] }),
  getSourceText: () => lastText,
});

/** 在 hay 里找 needle，多处命中时用前后文消歧（与 host 端 anchor.locate 同构）。 */
function locate(hay: string, needle: string, before: string, after: string): number {
  if (!needle) {
    return -1;
  }
  const occ: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    occ.push(i);
  }
  if (occ.length <= 1) {
    return occ.length === 1 ? occ[0] : -1;
  }
  let best = occ[0];
  let bestScore = -1;
  for (const i of occ) {
    const pre = hay.slice(Math.max(0, i - before.length), i);
    const post = hay.slice(i + needle.length, i + needle.length + after.length);
    let score = 0;
    if (before && pre.endsWith(before)) {
      score += 2;
    }
    if (after && post.startsWith(after)) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// ─── 高亮 ───────────────────────────────────────────────────────────
function findBlock(line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  content?.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
    const s = Number(el.getAttribute('data-line'));
    const e = Number(el.getAttribute('data-end-line'));
    if (s <= line && line < e) {
      // 取起始行最大的（最内层块）。
      if (!best || s >= Number(best.getAttribute('data-line'))) {
        best = el;
      }
    }
  });
  return best;
}

/** 在块内把渲染态 quote 包成 <mark>（可能跨多个文本节点）；命中返回 true。 */
function markText(block: HTMLElement, t: WireThread): boolean {
  const q = t.rendered?.quote;
  if (!q) {
    return false;
  }
  const nodes: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest('.katex-mathml, [aria-hidden="true"], template')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let acc = '';
  let n = walker.nextNode();
  while (n) {
    const text = n.nodeValue ?? '';
    nodes.push({ node: n as Text, start: acc.length });
    acc += text;
    n = walker.nextNode();
  }
  const idx = locate(acc, q, t.rendered?.before ?? '', t.rendered?.after ?? '');
  if (idx < 0) {
    return false;
  }
  const end = idx + q.length;
  let wrapped = false;
  for (const { node, start } of nodes) {
    const len = (node.nodeValue ?? '').length;
    const segStart = Math.max(idx, start);
    const segEnd = Math.min(end, start + len);
    if (segStart >= segEnd) {
      continue;
    }
    const range = document.createRange();
    range.setStart(node, segStart - start);
    range.setEnd(node, segEnd - start);
    const mark = document.createElement('mark');
    mark.className = `mdc-hl${t.status === 'resolved' ? ' resolved' : ''}`;
    mark.setAttribute('data-thread-id', t.id);
    try {
      range.surroundContents(mark);
      wrapped = true;
    } catch {
      // 该段跨了元素边界，surroundContents 失败，跳过这段。
    }
  }
  return wrapped;
}

function clearHighlights(): void {
  content?.querySelectorAll('mark.mdc-hl').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) {
      return;
    }
    while (m.firstChild) {
      parent.insertBefore(m.firstChild, m);
    }
    parent.removeChild(m);
    parent.normalize();
  });
  content?.querySelectorAll('.mdc-block-hl').forEach((el) => {
    el.classList.remove('mdc-block-hl');
    el.removeAttribute('data-thread-id');
    el.removeAttribute('data-thread-ids');
  });
  content?.querySelectorAll('.mdc-mermaid-node-hl').forEach((el) => {
    el.classList.remove('mdc-mermaid-node-hl', 'resolved', 'active');
    el.removeAttribute('data-thread-id');
    el.removeAttribute('data-thread-ids');
  });
}

/** 锚点行范围 [startLine, endLineExcl) 覆盖的顶层块（多块选区时不止第一块）。 */
function blocksInRange(startLine: number, endLineExcl: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  content?.querySelectorAll<HTMLElement>(':scope > [data-line]').forEach((el) => {
    const s = Number(el.getAttribute('data-line'));
    const e = Number(el.getAttribute('data-end-line'));
    if (s < endLineExcl && e > startLine) {
      out.push(el);
    }
  });
  return out;
}

function applyHighlights(threads: WireThread[]): void {
  for (const t of threads) {
    if (t.orphaned || t.kind === 'document') {
      continue;
    }
    if (t.target?.kind === 'mermaid-node') {
      const diagram =
        findBlock(t.blockStartLine)?.closest<HTMLElement>('.mdc-mermaid') ?? findBlock(t.blockStartLine);
      const node = diagram?.querySelector<HTMLElement>(
        `.mdc-mermaid-commentable-node[data-mdc-node-id="${CSS.escape(t.target.nodeId)}"]`,
      );
      if (node) {
        node.classList.add('mdc-mermaid-node-hl');
        const ids = new Set((node.dataset.threadIds ?? '').split(',').filter(Boolean));
        ids.add(t.id);
        node.dataset.threadIds = [...ids].join(',');
        const openIds = new Set((node.dataset.openThreadIds ?? '').split(',').filter(Boolean));
        if (t.status === 'open') {
          openIds.add(t.id);
        }
        node.dataset.openThreadIds = [...openIds].join(',');
        node.classList.toggle('resolved', openIds.size === 0);
        continue;
      }
      const fallback = diagram?.closest<HTMLElement>('.mdc-mermaid') ?? diagram;
      if (fallback) {
        fallback.classList.add('mdc-block-hl');
        const ids = new Set((fallback.dataset.threadIds ?? '').split(',').filter(Boolean));
        ids.add(t.id);
        fallback.dataset.threadIds = [...ids].join(',');
      }
      continue;
    }
    // 单块内能原样找到渲染 quote → 选词级精确高亮。
    const startBlock = findBlock(t.blockStartLine);
    if (startBlock && markText(startBlock, t)) {
      continue;
    }
    // 退回整块高亮：覆盖锚点行范围内的所有块（多块选区不止第一块）。
    const blocks = blocksInRange(t.blockStartLine, t.blockEndLine);
    const targets = blocks.length ? blocks : startBlock ? [startBlock] : [];
    for (const b of targets) {
      b.classList.add('mdc-block-hl');
      b.setAttribute('data-thread-id', t.id);
    }
  }
}

// ─── 侧栏 ───────────────────────────────────────────────────────────
/** 展示用：剥掉行首 markdown 标记（#、-、*、+、>、有序号），让整行/整块引用更干净。 */
function stripMarks(s: string): string {
  return s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '');
}

function cardHtml(t: WireThread): string {
  let label: string;
  if (t.kind === 'document') {
    label = '📄 全文';
  } else {
    // 引用在选词那一刻已冻结进存储，只读快照（rendered.quote → 源码 quote），绝不回退读 live DOM。
    const q = (t.rendered?.quote || stripMarks(t.quote)).trim();
    label = q ? esc(clip(q, CONTEXT_LEN)) : '（整段）';
  }
  const comments = t.comments
    .map(
      (c) =>
        `<div class="mdc-cmt" data-comment-id="${c.id}">
    <div class="mdc-cmt-head">
      <span class="mdc-author ${c.author === 'agent' ? 'agent' : ''}">${esc(authorName(c.author))}</span>
      <span class="mdc-time">${esc(relativeTime(c.createdAt))}</span>
      <span class="mdc-cmt-tools">
        <button class="mdc-icon mdc-tip" data-act="editComment" data-tip="编辑这条评论">${ICON_EDIT}</button>
        <button class="mdc-icon mdc-tip" data-act="delComment" data-tip="删除这条评论">${ICON_DELETE}</button>
      </span>
    </div>
    <div class="mdc-body">${esc(c.body)}</div>
  </div>`,
    )
    .join('');
  const resolved = t.status === 'resolved';
  const orphaned = t.orphaned === true;
  return `<div class="mdc-card ${resolved ? 'resolved' : ''} ${orphaned ? 'orphaned' : ''}" data-thread-id="${t.id}" data-status="${t.status}">
  <div class="mdc-card-head">
    <div class="mdc-card-quote">${orphaned ? '<span class="mdc-orphaned-tag">原文已删除</span> ' : ''}${label}</div>
    <div class="mdc-card-tools">
      ${
        orphaned
          ? ''
          : `<button class="mdc-icon mdc-tip" data-act="reveal" data-tip="${t.kind === 'document' ? '打开文档' : '在源码中显示'}">${ICON_SOURCE}</button>
      <button class="mdc-icon mdc-tip resolve ${resolved ? 'on' : ''}" data-act="resolve" data-tip="${resolved ? '重新打开' : '标记已解决'}">${ICON_RESOLVE}</button>`
      }
    </div>
  </div>
  <div class="mdc-card-comments">${comments}</div>
  <div class="mdc-card-reply">
    <textarea class="mdc-reply" placeholder="回复…（回车换行，${submitKey}+回车 发送）"></textarea>
    <button class="mdc-icon mdc-send mdc-tip" data-act="reply" data-tip="发送（${submitKey}+回车）">${ICON_SEND}</button>
  </div>
</div>`;
}

function renderSidebar(threads: WireThread[]): void {
  if (!sidebar) {
    return;
  }
  if (threads.length === 0) {
    const msg =
      activeTab === 'open'
        ? '没有未解决的评论 🎉'
        : activeTab === 'resolved'
          ? '没有已解决的评论'
          : '还没有评论。在左侧划词试试。';
    sidebar.innerHTML = `<div class="mdc-empty">${msg}</div>`;
    return;
  }
  const sorted = [...threads].sort((a, b) => a.blockStartLine - b.blockStartLine);
  sidebar.innerHTML = sorted.map(cardHtml).join('');
}

// ─── 新建评论草稿（webview 内多行编辑器，替代 showInputBox）─────────
// 三种模式：划词（带 selection）/ Mermaid 整图 / 全文。
let draftSelection: RenderedSelection | null = null;
let draftIsDoc = false;

function renderDraft(labelHtml: string): void {
  if (!draftEl) {
    return;
  }
  expandSidebar();
  draftEl.innerHTML = `<div class="mdc-draft">
  <div class="mdc-card-quote">${labelHtml}</div>
  <textarea class="mdc-draft-input" placeholder="写下你的评论…（Markdown，${submitKey}+Enter 提交，Esc 取消）"></textarea>
  <div class="mdc-card-actions">
    <button data-act="cancel">取消</button>
    <button data-act="submit">评论</button>
  </div>
</div>`;
  const ta = draftEl.querySelector<HTMLTextAreaElement>('.mdc-draft-input');
  // 紧跟划词点击时 webview 里同步 focus 偶发不生效：先把 iframe 窗口拿到焦点，再多打几拍补焦。
  const focus = (): void => {
    window.focus();
    ta?.focus();
  };
  focus();
  requestAnimationFrame(focus);
  setTimeout(focus, 0);
  draftEl.scrollIntoView({ block: 'nearest' });
}

function openSelDraft(sel: RenderedSelection): void {
  draftIsDoc = false;
  draftSelection = sel;
  pendingMermaidComment = undefined;
  renderDraft(sel.spansMultipleBlocks ? '跨段落' : esc(clip(sel.quote, CONTEXT_LEN)));
}

function openDocDraft(): void {
  draftIsDoc = true;
  draftSelection = null;
  pendingMermaidComment = undefined;
  renderDraft('📄 全文评论');
}

function renderBlockDraft(label: string): void {
  draftIsDoc = false;
  draftSelection = null;
  renderDraft(esc(label));
}

function closeDraft(): void {
  draftSelection = null;
  draftIsDoc = false;
  pendingMermaidComment = undefined;
  if (draftEl) {
    draftEl.innerHTML = '';
  }
}

function submitDraft(): void {
  if (!draftEl) {
    return;
  }
  const ta = draftEl.querySelector<HTMLTextAreaElement>('.mdc-draft-input');
  const text = ta?.value.trim() ?? '';
  if (!text) {
    ta?.focus();
    return; // 空评论不提交
  }
  if (draftIsDoc) {
    post({ type: 'createDocThread', text });
  } else if (pendingMermaidComment) {
    if (pendingMermaidComment.target === 'mermaid-node') {
      post({
        type: 'createMermaidNodeThread',
        startLine: pendingMermaidComment.startLine,
        endLine: pendingMermaidComment.endLine,
        label: pendingMermaidComment.label,
        nodeId: pendingMermaidComment.nodeId,
        text,
      });
    } else {
      post({
        type: 'createBlockThread',
        startLine: pendingMermaidComment.startLine,
        endLine: pendingMermaidComment.endLine,
        label: pendingMermaidComment.label,
        target: pendingMermaidComment.target,
        text,
      });
    }
  } else if (draftSelection) {
    post({ type: 'createThread', selection: draftSelection, text });
  } else {
    return;
  }
  closeDraft();
}

document.getElementById('mdc-add-doc')?.addEventListener('click', openDocDraft);

draftEl?.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).getAttribute('data-act');
  if (act === 'submit') {
    submitDraft();
  } else if (act === 'cancel') {
    closeDraft();
  }
});
draftEl?.addEventListener('keydown', (e) => {
  if (!(e.target as HTMLElement).classList.contains('mdc-draft-input')) {
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    submitDraft();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeDraft();
  }
});

// ─── 分类 Tab + 选中联动 ───────────────────────────────────────────
type Tab = 'open' | 'resolved' | 'all';
let activeTab: Tab = 'open';
let selectedId: string | null = null;

function filterByTab(threads: WireThread[]): WireThread[] {
  if (activeTab === 'open') {
    return threads.filter((t) => t.status === 'open');
  }
  if (activeTab === 'resolved') {
    return threads.filter((t) => t.status === 'resolved');
  }
  return threads;
}

function updateTabs(threads: WireThread[]): void {
  const counts: Record<Tab, number> = {
    open: threads.filter((t) => t.status === 'open').length,
    resolved: threads.filter((t) => t.status === 'resolved').length,
    all: threads.length,
  };
  document.querySelectorAll<HTMLElement>('.mdc-tab').forEach((btn) => {
    const tab = btn.getAttribute('data-tab') as Tab;
    btn.classList.toggle('active', tab === activeTab);
    const badge = btn.querySelector<HTMLElement>('.mdc-tab-n');
    if (!badge) {
      return;
    }
    // 未解决 count 常驻；其余仅在该 tab 激活时显示。
    const show = tab === 'open' || tab === activeTab;
    badge.textContent = show ? String(counts[tab]) : '';
    badge.classList.toggle('show', show);
  });
}

/** 选中一条评论：正文高亮 + 侧栏卡片同时高亮（持久，直到换选），并滚到指定一侧。 */
function selectThread(id: string, scrollTo: 'content' | 'sidebar'): void {
  selectedId = id;
  if (scrollTo === 'sidebar') {
    expandSidebar();
  }
  applySelected();
  const sel = CSS.escape(id);
  const target =
    scrollTo === 'content'
      ? (content?.querySelector<HTMLElement>(`[data-thread-id="${sel}"]`) ??
        Array.from(content?.querySelectorAll<HTMLElement>('[data-thread-ids]') ?? []).find((element) =>
          (element.dataset.threadIds ?? '').split(',').includes(id),
        ))
      : sidebar?.querySelector<HTMLElement>(`.mdc-card[data-thread-id="${sel}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: scrollTo === 'content' ? 'center' : 'nearest' });
}

function applySelected(): void {
  content
    ?.querySelectorAll('.mdc-hl.active, .mdc-block-hl.active, .mdc-mermaid-node-hl.active')
    .forEach((e) => e.classList.remove('active'));
  sidebar?.querySelectorAll('.mdc-card.active').forEach((e) => e.classList.remove('active'));
  if (!selectedId) {
    return;
  }
  const sel = CSS.escape(selectedId);
  content?.querySelectorAll(`[data-thread-id="${sel}"]`).forEach((e) => e.classList.add('active'));
  content?.querySelectorAll<HTMLElement>('[data-thread-ids]').forEach((element) => {
    if ((element.dataset.threadIds ?? '').split(',').includes(selectedId ?? '')) {
      element.classList.add('active');
    }
  });
  sidebar?.querySelector(`.mdc-card[data-thread-id="${sel}"]`)?.classList.add('active');
}

document.getElementById('mdc-tabs')?.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('.mdc-tab')?.getAttribute('data-tab') as
    Tab | undefined;
  if (tab && tab !== activeTab) {
    activeTab = tab;
    refreshThreads(lastThreads);
  }
});

// ─── 渲染入口 ───────────────────────────────────────────────────────
function refreshThreads(threads: WireThread[]): void {
  lastThreads = threads;
  updateTabs(threads);
  const shown = filterByTab(threads);
  clearHighlights();
  applyHighlights(shown);
  renderSidebar(shown);
  applySelected();
}

function addCodeCopyButtons(): void {
  content?.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const block = code.parentElement;
    if (!block || block.querySelector(':scope > .mdc-code-copy')) {
      return;
    }
    block.classList.add('mdc-code-block');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mdc-code-copy';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码块');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = '已复制';
        window.setTimeout(() => {
          button.textContent = '复制';
        }, 1600);
      } catch {
        const selection = window.getSelection();
        if (!selection) {
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
      }
    });
    block.append(button);
  });
}

function requestLocalResources(): void {
  if (!content) {
    return;
  }
  const sources = new Set<string>();
  content.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((image) => {
    const source = image.dataset.src?.trim();
    if (!source || /^https:/i.test(source) || /^data:image\//i.test(source)) {
      return;
    }
    image.classList.add('mdc-image-pending');
    image.classList.remove('mdc-image-error');
    sources.add(source);
  });
  if (sources.size === 0) {
    pendingResourceRequests.clear();
    return;
  }
  pendingResourceRequests.clear();
  const allSources = [...sources];
  for (let index = 0; index < allSources.length; index += RESOURCE_BATCH_SIZE) {
    const requestId = `resources-${++resourceRequestGeneration}`;
    pendingResourceRequests.add(requestId);
    post({
      type: 'resolveResources',
      requestId,
      sources: allSources.slice(index, index + RESOURCE_BATCH_SIZE),
    });
  }
}

function imageActionButton(action: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mdc-image-action';
  button.dataset.imageAction = action;
  button.textContent = label;
  return button;
}

function addImageTools(): void {
  content?.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((image) => {
    if (image.closest('.mdc-image-wrap')) {
      return;
    }
    const source = image.dataset.src ?? '';
    const wrapper = document.createElement('span');
    wrapper.className = 'mdc-image-wrap';
    image.replaceWith(wrapper);
    wrapper.append(image);
    const toolbar = document.createElement('span');
    toolbar.className = 'mdc-image-tools';
    toolbar.append(imageActionButton('copy', '复制图片'));
    if (!/^(?:data:|http:)/i.test(source)) {
      toolbar.append(imageActionButton('open', '打开源文件'));
    }
    toolbar.addEventListener('click', async (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-image-action]')?.dataset
        .imageAction;
      if (action === 'open') {
        post({ type: 'openImage', source });
        return;
      }
      if (action !== 'copy') {
        return;
      }
      try {
        const response = await fetch(image.src);
        const blob = await response.blob();
        const png =
          blob.type === 'image/png'
            ? blob
            : await new Promise<Blob>((resolve, reject) => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) {
                  reject(new Error('Canvas is unavailable'));
                  return;
                }
                context.drawImage(image, 0, 0);
                canvas.toBlob(
                  (value) => (value ? resolve(value) : reject(new Error('Image conversion failed'))),
                  'image/png',
                );
              });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } catch {
        post({ type: 'copyImageFallback', source });
      }
    });
    wrapper.append(toolbar);
  });
}

function normalizeRenderedResources(): void {
  content?.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    image.dataset.src = image.getAttribute('src') ?? '';
  });
  content?.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    link.dataset.href = link.getAttribute('href') ?? '';
  });
}

function rangesOverlap(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && rangeStart < end;
}

function applyLineChanges(changes?: PreviewLineChanges): void {
  content
    ?.querySelectorAll('.mdc-diff-added, .mdc-diff-modified, .mdc-diff-deleted-marker')
    .forEach((element) => {
      element.classList.remove('mdc-diff-added', 'mdc-diff-modified');
      if (element.classList.contains('mdc-diff-deleted-marker')) {
        element.remove();
      }
    });
  if (!content || !changes) {
    return;
  }
  content
    .querySelectorAll<HTMLElement>(':scope > .mdc-source-block[data-line][data-end-line]')
    .forEach((element) => {
      const start = Number(element.dataset.line);
      const end = Number(element.dataset.endLine);
      if (changes.modified.some((range) => rangesOverlap(start, end, range.startLine, range.endLine))) {
        element.classList.add('mdc-diff-modified');
      }
      if (changes.added.some((range) => rangesOverlap(start, end, range.startLine, range.endLine))) {
        element.classList.add('mdc-diff-added');
      }
    });
  for (const deletion of changes.deleted) {
    const blocks = Array.from(
      content.querySelectorAll<HTMLElement>(':scope > .mdc-source-block[data-line][data-end-line]'),
    );
    const containing = blocks.find(
      (element) =>
        Number(element.dataset.line) < deletion.atLine && deletion.atLine < Number(element.dataset.endLine),
    );
    const target =
      containing ?? blocks.find((element) => Number(element.dataset.line) >= deletion.atLine) ?? null;
    const marker = document.createElement('div');
    marker.className = 'mdc-diff-deleted-marker';
    marker.textContent = `删除 ${deletion.count} 行`;
    marker.dataset.line = String(deletion.atLine);
    if (containing) {
      marker.classList.add('inside');
      containing.prepend(marker);
    } else {
      target ? target.before(marker) : content.append(marker);
    }
  }
}

function setupNavigation(state?: PreviewNavigationState): void {
  navigation?.dispose();
  if (!content) {
    navigation = undefined;
    return;
  }
  navigation = createPreviewNavigation(content, {
    onPreviewScroll(line) {
      if (renderOptions.scrollEditorWithPreview) {
        post({ type: 'previewScroll', line });
      }
    },
    onRevealSourceLine(line) {
      if (renderOptions.doubleClickToSwitchToEditor) {
        post({ type: 'revealSourceLine', line });
      }
    },
    onOpenLink(href) {
      post({ type: 'openLink', href });
    },
  });
  if (state) {
    navigation.restoreState(state);
  }
}

function restoreNavigationLater(state: PreviewNavigationState | undefined, generation: number): void {
  if (!state) {
    return;
  }
  requestAnimationFrame(() => {
    if (generation === renderGeneration) {
      navigation?.restoreState(state);
    }
  });
}

function render(
  text: string,
  threads: WireThread[],
  options: PreviewRenderOptions,
  lineChanges?: PreviewLineChanges,
): void {
  const navigationState = navigation?.captureState();
  const mermaidStates: MermaidViewStates = mermaidRuntime.captureViewState(content ?? document);
  const generation = ++renderGeneration;
  if (lastText && text !== lastText) {
    closeDraft();
  }
  lastText = text;
  renderOptions = options;
  applyPreviewAppearance(options);
  if (content) {
    content.innerHTML = markdownRenderer.render(text, {
      frontMatter: options.frontMatter,
      breaks: options.breaks,
      typographer: options.typographer,
      html: options.html,
    });
  }
  setupNavigation(navigationState);
  addCodeCopyButtons();
  normalizeRenderedResources();
  addImageTools();
  requestLocalResources();
  applyLineChanges(lineChanges);
  outlineUi.refresh();
  refreshThreads(threads);
  hideButton();
  void mermaidRuntime
    .render(content ?? document, {
      viewStates: mermaidStates,
      nodeCommentsEnabled: options.mermaidNodeComments,
    })
    .then(() => {
      if (generation !== renderGeneration) {
        return;
      }
      refreshThreads(lastThreads);
      restoreNavigationLater(navigationState, generation);
    });
}

// ─── 浮动「评论」按钮 ───────────────────────────────────────────────
const commentBtn = document.createElement('button');
commentBtn.textContent = '💬 评论';
commentBtn.style.cssText = [
  'position:fixed',
  'z-index:1000',
  'display:none',
  'padding:4px 10px',
  'font-size:12px',
  'line-height:1.4',
  'border:none',
  'border-radius:6px',
  'cursor:pointer',
  'background:var(--vscode-button-background)',
  'color:var(--vscode-button-foreground)',
  'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
].join(';');
document.body.appendChild(commentBtn);

let pending: RenderedSelection | null = null;

function nearestBlock(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.hasAttribute('data-line')) {
    el = el.parentElement;
  }
  return el;
}

function hideButton(): void {
  commentBtn.style.display = 'none';
  pending = null;
}

function onSelect(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    hideButton();
    return;
  }
  const rawQuote = sel.toString();
  const quote = rawQuote.trim();
  if (!quote) {
    hideButton();
    return;
  }
  const range = sel.getRangeAt(0);
  // 选区落在侧栏里就不处理。
  if (!content || !content.contains(range.commonAncestorContainer)) {
    hideButton();
    return;
  }
  const startBlock = nearestBlock(range.startContainer);
  const endBlock = nearestBlock(range.endContainer);
  if (!startBlock || !endBlock) {
    hideButton();
    return;
  }

  const spansMultipleBlocks =
    startBlock !== endBlock ||
    startBlock.classList.contains('mdc-safe-html-block') ||
    endBlock.classList.contains('mdc-safe-html-block');
  const blockStartLine = Number(startBlock.getAttribute('data-line'));
  const blockEndLine = Number((spansMultipleBlocks ? endBlock : startBlock).getAttribute('data-end-line'));

  let before = '';
  let after = '';
  if (!spansMultipleBlocks) {
    const blockText = startBlock.textContent ?? '';
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(startBlock);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const idx = prefixRange.toString().length + (rawQuote.length - rawQuote.trimStart().length);
    if (idx >= 0) {
      before = blockText.slice(Math.max(0, idx - CONTEXT_LEN), idx);
      after = blockText.slice(idx + quote.length, idx + quote.length + CONTEXT_LEN);
    }
  }
  pending = { blockStartLine, blockEndLine, quote, before, after, spansMultipleBlocks };

  const rect = range.getBoundingClientRect();
  commentBtn.style.display = 'block';
  commentBtn.style.top = `${Math.max(8, rect.top - 34)}px`;
  commentBtn.style.left = `${Math.min(window.innerWidth - 90, rect.right + 6)}px`;
}

commentBtn.addEventListener('mousedown', (e) => e.preventDefault());
commentBtn.addEventListener('click', () => {
  const sel = pending; // hideButton 会清空 pending，先存下来
  window.getSelection()?.removeAllRanges();
  hideButton();
  // 清选区会把焦点夺回正文，所以渲染草稿 + focus 放到最后一步。
  if (sel) {
    openSelDraft(sel);
  }
});

document.addEventListener('mouseup', () => window.setTimeout(onSelect, 0));
document.addEventListener('scroll', hideButton, true);

// ─── 事件：正文点高亮 → 边栏；边栏点卡片/按钮 ───────────────────────
content?.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-thread-id], [data-thread-ids]');
  if (el && content.contains(el)) {
    const directId = el.getAttribute('data-thread-id');
    const ids = (el.dataset.threadIds ?? '').split(',').filter(Boolean);
    const id = directId ?? (selectedId && ids.includes(selectedId) ? selectedId : ids[0]);
    if (id) {
      selectThread(id, 'sidebar');
    }
  }
});

function submitReply(input: HTMLTextAreaElement, id: string): void {
  const v = input.value.trim();
  if (v) {
    post({ type: 'reply', threadId: id, text: v });
    input.value = '';
  }
}

// 行内编辑已发出的评论：把 .mdc-body 换成可编辑表单（Cmd/Ctrl+回车 保存，Esc 取消）。
function enterEdit(cmt: HTMLElement): void {
  if (cmt.querySelector('.mdc-edit')) {
    return; // 已在编辑态
  }
  const body = cmt.querySelector<HTMLElement>('.mdc-body');
  if (!body) {
    return;
  }
  const form = document.createElement('div');
  form.className = 'mdc-edit';
  form.innerHTML = `<textarea class="mdc-edit-input"></textarea>
    <div class="mdc-card-actions">
      <button data-act="editCancel">取消</button>
      <button data-act="editSave">保存</button>
    </div>`;
  const ta = form.querySelector<HTMLTextAreaElement>('.mdc-edit-input');
  if (ta) {
    ta.value = body.textContent ?? ''; // .mdc-body 的 textContent 即原始正文（esc 仅影响 HTML，textContent 已解码）。
  }
  body.style.display = 'none';
  body.insertAdjacentElement('afterend', form);
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function exitEdit(cmt: HTMLElement): void {
  cmt.querySelector('.mdc-edit')?.remove();
  const body = cmt.querySelector<HTMLElement>('.mdc-body');
  if (body) {
    body.style.display = '';
  }
}

function saveEdit(cmt: HTMLElement, threadId: string): void {
  const ta = cmt.querySelector<HTMLTextAreaElement>('.mdc-edit-input');
  const text = ta?.value.trim() ?? '';
  if (!text) {
    ta?.focus();
    return; // 空内容不保存
  }
  post({ type: 'editComment', threadId, commentId: cmt.getAttribute('data-comment-id') ?? '', text });
  exitEdit(cmt); // host 写盘后会回推刷新；本地先退出编辑态，避免等待回推时闪烁。
}

sidebar?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>('.mdc-card');
  if (!card) {
    return;
  }
  const id = card.getAttribute('data-thread-id') ?? '';
  // closest('[data-act]') 让点到按钮里的 SVG 也能命中。
  const act = target.closest<HTMLElement>('[data-act]')?.getAttribute('data-act');
  if (act === 'reply') {
    submitReply(card.querySelector('.mdc-reply') as HTMLTextAreaElement, id);
  } else if (act === 'resolve') {
    post({ type: 'resolve', threadId: id, resolved: card.getAttribute('data-status') === 'open' });
  } else if (act === 'reveal') {
    post({ type: 'revealSource', threadId: id });
  } else if (act === 'editComment' || act === 'editSave' || act === 'editCancel') {
    const cmt = target.closest<HTMLElement>('.mdc-cmt');
    if (cmt) {
      if (act === 'editComment') {
        enterEdit(cmt);
      } else if (act === 'editSave') {
        saveEdit(cmt, id);
      } else {
        exitEdit(cmt);
      }
    }
  } else if (act === 'delComment') {
    const cmt = target.closest<HTMLElement>('.mdc-cmt');
    if (cmt) {
      post({ type: 'deleteComment', threadId: id, commentId: cmt.getAttribute('data-comment-id') ?? '' });
    }
  } else if (!target.classList.contains('mdc-reply') && !target.classList.contains('mdc-edit-input')) {
    selectThread(id, 'content');
  }
});

sidebar?.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const cmdEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
  // 回复：回车换行，Cmd/Ctrl+回车 发送。
  if (cmdEnter && target.classList.contains('mdc-reply')) {
    e.preventDefault();
    const card = target.closest<HTMLElement>('.mdc-card');
    if (card) {
      submitReply(target as HTMLTextAreaElement, card.getAttribute('data-thread-id') ?? '');
    }
    return;
  }
  // 编辑：回车换行，Cmd/Ctrl+回车 保存，Esc 取消。
  if (target.classList.contains('mdc-edit-input')) {
    const cmt = target.closest<HTMLElement>('.mdc-cmt');
    const card = target.closest<HTMLElement>('.mdc-card');
    if (cmdEnter && cmt && card) {
      e.preventDefault();
      saveEdit(cmt, card.getAttribute('data-thread-id') ?? '');
    } else if (e.key === 'Escape' && cmt) {
      e.preventDefault();
      exitEdit(cmt);
    }
  }
});

// ─── 与 host 通信 ───────────────────────────────────────────────────
window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as HostToWebview;
  if (msg.type === 'render') {
    render(msg.text, msg.threads, msg.options, msg.diff?.changes);
  } else if (msg.type === 'threads') {
    refreshThreads(msg.threads);
  } else if (msg.type === 'revealThread') {
    selectThread(msg.threadId, 'content');
  } else if (msg.type === 'revealLine') {
    if (renderOptions.scrollPreviewWithEditor) {
      navigation?.scrollToSourceLine(msg.line);
    }
  } else if (msg.type === 'resolvedResources' && pendingResourceRequests.delete(msg.requestId)) {
    const resources = new Map(msg.resources.map((resource) => [resource.source, resource]));
    content?.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((image) => {
      const source = image.dataset.src;
      const resolved = source ? resources.get(source) : undefined;
      if (resolved?.uri) {
        image.src = resolved.uri;
        image.classList.remove('mdc-image-pending', 'mdc-image-error');
        image.removeAttribute('title');
      } else if (resolved?.error) {
        image.removeAttribute('src');
        image.classList.remove('mdc-image-pending');
        image.classList.add('mdc-image-error');
        image.title = resolved.error;
        if (!image.alt) {
          image.alt = resolved.error;
        }
      }
    });
  }
});

post({ type: 'ready' });
