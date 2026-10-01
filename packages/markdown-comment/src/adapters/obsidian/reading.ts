// 阅读视图：划词 / 整块评论的捕获、已有评论的高亮；编辑视图的鼠标划词也共用这里的浮出按钮。
// 渲染 DOM 没有 data-line，行号靠 post processor 的 ctx.getSectionInfo(el) —— 用到时才取，并经 resolveSectionLines 校验。
import { MarkdownView, Notice, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { CONTEXT_LEN, lineStarts, locate, positionAt, relocate } from '../../core/anchor';
import type { TextRange } from '../../core/anchor';
import type { RenderedSelection } from '../../preview/messages';
import type { StoredThread } from '../../types';
import { draftFromEditorSelection } from './editing';
import { applyEditorMarks, editorMarksField } from './editor-marks';
import type { EditorMark } from './editor-marks';
import type MarkdownCommentPlugin from './main';
import { anchorFromRenderedSelection, clip, isOrphaned, pickSourceText, resolveSectionLines } from './model';

const REFRESH_DELAY_MS = 120;
const BUTTON_OFFSET_Y = 34;
const BUTTON_OFFSET_X = 6;
const BUTTON_EDGE_X = 90;
const BUTTON_MIN_TOP = 8;

interface Section {
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
}

/** 选区捕获结果：只含同步可得的 DOM 信息，行号等到真正创建草稿时再取。 */
interface PendingSelection {
  file: TFile;
  start: Section;
  end: Section;
  quote: string;
  before: string;
  after: string;
  spansMultipleBlocks: boolean;
  rect: DOMRect;
}

function clearMarks(el: HTMLElement): void {
  const marks = el.querySelectorAll('span.mdc-mark');
  if (marks.length === 0) {
    return;
  }
  marks.forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
  el.normalize();
}

/** 在 el 的文本节点里按渲染态引用找一次，把命中的片段包成 `<span class="mdc-mark">`。 */
function markQuote(
  el: HTMLElement,
  rendered: { quote: string; before: string; after: string },
  thread: StoredThread,
  active: boolean,
): boolean {
  const nodes: { node: Text; start: number }[] = [];
  let full = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: full.length });
    full += n.nodeValue ?? '';
  }
  const idx = locate(full, rendered.quote, rendered.before, rendered.after);
  if (idx < 0) {
    return false;
  }
  const end = idx + rendered.quote.length;
  // 从后往前包，前面节点的 offset 不受 splitText 影响。
  for (let i = nodes.length - 1; i >= 0; i--) {
    const { node, start } = nodes[i];
    const from = Math.max(idx - start, 0);
    const to = Math.min(end - start, node.length);
    if (from >= to) {
      continue;
    }
    const target = from > 0 ? node.splitText(from) : node;
    if (to - from < target.length) {
      target.splitText(to - from);
    }
    const span = document.createElement('span');
    span.className = ['mdc-mark', thread.status === 'resolved' ? 'resolved' : '', active ? 'active' : '']
      .filter(Boolean)
      .join(' ');
    span.dataset.threadId = thread.id;
    target.replaceWith(span);
    span.appendChild(target);
  }
  return true;
}

export class ReadingController {
  private readonly sections = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
  private floatBtn: HTMLButtonElement | null = null;
  private pending: PendingSelection | null = null;
  private pendingEditor: MarkdownView | null = null;
  private refreshTimer: number | undefined;

  constructor(private readonly plugin: MarkdownCommentPlugin) {}

  register(): void {
    const { plugin } = this;
    plugin.registerMarkdownPostProcessor((el, ctx) => this.onSection(el, ctx));
    plugin.registerEditorExtension(editorMarksField);

    const btn = document.body.createEl('button', { cls: 'mdc-float-btn', text: '💬 评论' });
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const sel = this.pending;
      const editorView = this.pendingEditor;
      this.hideButton();
      if (editorView) {
        plugin.run(this.commentEditorSelection(editorView));
        return;
      }
      window.getSelection()?.removeAllRanges();
      if (sel) {
        plugin.run(this.commentPending(sel));
      }
    });
    this.floatBtn = btn;

    plugin.registerDomEvent(document, 'mouseup', (e) => window.setTimeout(() => this.onSelect(e), 0));
    plugin.registerDomEvent(document, 'click', (e) => this.onClick(e));
  }

  destroy(): void {
    window.clearTimeout(this.refreshTimer);
    this.floatBtn?.remove();
    this.floatBtn = null;
    document.querySelectorAll<HTMLElement>('.mdc-section').forEach((el) => {
      clearMarks(el);
      el.querySelector(':scope > .mdc-block-btn')?.remove();
      el.classList.remove('mdc-section', 'mdc-section-marked', 'resolved', 'active');
    });
  }

  // ─── post processor ──────────────────────────────────────────

  private onSection(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    this.sections.set(el, ctx);
    el.classList.add('mdc-section');
    // 块按钮等 el 挂进阅读视图后再按需加，避免给别处（悬浮预览、其它插件）渲染的内容也塞按钮。
    el.addEventListener('mouseenter', () => this.ensureBlockButton(el));
    this.scheduleRefresh();
  }

  private ensureBlockButton(el: HTMLElement): void {
    if (el.querySelector(':scope > .mdc-block-btn') || !el.closest('.markdown-preview-view')) {
      return;
    }
    const ctx = this.sections.get(el);
    if (!ctx || !ctx.getSectionInfo(el)) {
      return;
    }
    const btn = el.createEl('button', {
      cls: 'mdc-block-btn',
      attr: { type: 'button', 'aria-label': '评论此块' },
    });
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.run(this.commentBlock({ el, ctx }));
    });
  }

  // ─── 选区捕获 ────────────────────────────────────────────────

  private viewContaining(node: Node): MarkdownView | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const { view } = leaf;
      if (view instanceof MarkdownView && view.file && view.previewMode.containerEl.contains(node)) {
        return view;
      }
    }
    return null;
  }

  /** 从节点向上找最近的已登记 section；属于嵌入内容（sourcePath 不同）的不处理。 */
  private sectionOf(node: Node | null, sourcePath: string): Section | null {
    let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
    while (el) {
      const ctx = this.sections.get(el);
      if (ctx) {
        return ctx.sourcePath === sourcePath ? { el, ctx } : null;
      }
      el = el.parentElement;
    }
    return null;
  }

  /** 复刻 webview.ts 的 onSelect：起止 section、渲染态 quote / before / after、是否跨块。 */
  private capture(): PendingSelection | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return null;
    }
    const rawQuote = sel.toString();
    const quote = rawQuote.trim();
    if (!quote) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const view = this.viewContaining(range.commonAncestorContainer);
    if (!view?.file || view.getMode() !== 'preview') {
      return null;
    }
    const start = this.sectionOf(range.startContainer, view.file.path);
    const end = this.sectionOf(range.endContainer, view.file.path);
    if (!start || !end) {
      return null;
    }
    const spansMultipleBlocks = start.el !== end.el;
    let before = '';
    let after = '';
    if (!spansMultipleBlocks) {
      const blockText = start.el.textContent ?? '';
      const prefix = document.createRange();
      prefix.selectNodeContents(start.el);
      prefix.setEnd(range.startContainer, range.startOffset);
      const idx = prefix.toString().length + (rawQuote.length - rawQuote.trimStart().length);
      before = blockText.slice(Math.max(0, idx - CONTEXT_LEN), idx);
      after = blockText.slice(idx + quote.length, idx + quote.length + CONTEXT_LEN);
    }
    return {
      file: view.file,
      start,
      end,
      quote,
      before,
      after,
      spansMultipleBlocks,
      rect: range.getBoundingClientRect(),
    };
  }

  /** 编辑视图（Live Preview / 源码模式）里有非空选区的活动视图。 */
  private editorSelectionView(target: EventTarget | null): MarkdownView | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || view.getMode() !== 'source' || !(target instanceof Node)) {
      return null;
    }
    if (!view.contentEl.contains(target) || !view.editor.getSelection().trim()) {
      return null;
    }
    return view;
  }

  private onSelect(e: MouseEvent): void {
    const pending = this.capture();
    const editorView = pending ? null : this.editorSelectionView(e.target);
    if ((!pending && !editorView) || !this.floatBtn) {
      this.hideButton();
      return;
    }
    this.pending = pending;
    this.pendingEditor = editorView;
    const top = pending ? pending.rect.top : e.clientY;
    const right = pending ? pending.rect.right : e.clientX;
    const { style } = this.floatBtn;
    style.display = 'block';
    style.top = `${Math.max(BUTTON_MIN_TOP, top - BUTTON_OFFSET_Y)}px`;
    style.left = `${Math.min(window.innerWidth - BUTTON_EDGE_X, right + BUTTON_OFFSET_X)}px`;
  }

  private hideButton(): void {
    if (this.floatBtn) {
      this.floatBtn.style.display = 'none';
    }
    this.pending = null;
    this.pendingEditor = null;
  }

  private async commentEditorSelection(view: MarkdownView): Promise<void> {
    const draft = await draftFromEditorSelection(this.plugin, view);
    if (draft) {
      this.plugin.startDraft(draft);
    }
  }

  /** 命令「添加划词评论」在阅读视图里的入口：等同点浮出按钮。 */
  commentCurrentSelection(): Promise<void> {
    const pending = this.capture();
    if (!pending) {
      new Notice('请先在阅读视图中选中要评论的文字');
      return Promise.resolve();
    }
    return this.commentPending(pending);
  }

  /** 此刻才取 getSectionInfo 并与最新源码核对；核对不上就明确提示，不乱锚。 */
  private sectionLines(text: string, section: Section): { startLine: number; endLine: number } | null {
    const info = section.ctx.getSectionInfo(section.el);
    return info ? resolveSectionLines(text, info) : null;
  }

  private async commentPending(p: PendingSelection): Promise<void> {
    const text = await this.plugin.readText(p.file);
    const first = this.sectionLines(text, p.start);
    const last = p.spansMultipleBlocks ? this.sectionLines(text, p.end) : first;
    if (!first || !last) {
      new Notice('无法确定所选内容在源码中的位置（文件可能刚被修改），请稍后重试');
      return;
    }
    const selection: RenderedSelection = {
      blockStartLine: first.startLine,
      blockEndLine: last.endLine + 1,
      quote: p.quote,
      before: p.before,
      after: p.after,
      spansMultipleBlocks: p.spansMultipleBlocks,
    };
    this.plugin.startDraft({
      file: p.file,
      preview: clip(p.quote),
      build: (t) => anchorFromRenderedSelection(t, selection),
      label: null,
      body: '',
    });
  }

  /** 整块评论：quote 为空 + spansMultipleBlocks，core 退回整块范围，源码引用就是块源码（图是 `![[x.png]]`）。 */
  private async commentBlock(section: Section): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(section.ctx.sourcePath);
    if (!(file instanceof TFile)) {
      return;
    }
    const text = await this.plugin.readText(file);
    const lines = this.sectionLines(text, section);
    if (!lines) {
      new Notice('无法确定该块在源码中的位置（文件可能刚被修改），请稍后重试');
      return;
    }
    const selection: RenderedSelection = {
      blockStartLine: lines.startLine,
      blockEndLine: lines.endLine + 1,
      quote: '',
      before: '',
      after: '',
      spansMultipleBlocks: true,
    };
    const anchor = anchorFromRenderedSelection(text, selection);
    this.plugin.startDraft({
      file,
      preview: clip(anchor?.quote ?? ''),
      build: (t) => anchorFromRenderedSelection(t, selection),
      label: null,
      body: '',
    });
  }

  // ─── 高亮 ────────────────────────────────────────────────────

  /** 侧栏选中的线程：阅读视图与编辑视图里它的高亮一直加深显示（同 VS Code 预览）。 */
  private activeId: string | null = null;

  scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refresh().catch(() => undefined);
    }, REFRESH_DELAY_MS);
  }

  private async refresh(): Promise<void> {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const { view } = leaf;
      if (!(view instanceof MarkdownView) || !view.file) {
        continue;
      }
      const els = Array.from(view.previewMode.containerEl.querySelectorAll<HTMLElement>('.mdc-section'));
      if (els.length > 0) {
        await this.refreshFile(view.file, els);
      }
      await this.refreshEditor(view, view.file);
    }
  }

  /** 当前文件里能定位到的划词线程，及其源码范围。 */
  private locatedThreads(file: TFile, text: string): { thread: StoredThread; range: TextRange }[] {
    const key = this.plugin.keyOf(file);
    const located: { thread: StoredThread; range: TextRange }[] = [];
    for (const thread of key ? this.plugin.store.load(key).threads : []) {
      const { anchor } = thread;
      const range = anchor.kind === 'selection' && !isOrphaned(text, anchor) ? relocate(text, anchor) : null;
      if (range) {
        located.push({ thread, range });
      }
    }
    return located;
  }

  private async refreshFile(file: TFile, els: HTMLElement[]): Promise<void> {
    const text = await this.plugin.app.vault.cachedRead(file);
    const starts = lineStarts(text);
    const located = this.locatedThreads(file, text).map(({ thread, range }) => ({
      thread,
      line: positionAt(text, starts, range.start).line,
    }));
    for (const el of els) {
      clearMarks(el);
      el.classList.remove('mdc-section-marked', 'resolved', 'active');
      delete el.dataset.mdcThreads;
      const ctx = this.sections.get(el);
      const info = ctx?.getSectionInfo(el);
      const lines = ctx && info && ctx.sourcePath === file.path ? resolveSectionLines(text, info) : null;
      if (!lines) {
        continue;
      }
      const blockThreads: StoredThread[] = [];
      for (const { thread, line } of located) {
        if (line < lines.startLine || line > lines.endLine) {
          continue;
        }
        const { rendered } = thread.anchor;
        if (!rendered?.quote || !markQuote(el, rendered, thread, thread.id === this.activeId)) {
          blockThreads.push(thread);
        }
      }
      if (blockThreads.length > 0) {
        el.classList.add('mdc-section-marked');
        el.classList.toggle(
          'resolved',
          blockThreads.every((t) => t.status === 'resolved'),
        );
        el.classList.toggle(
          'active',
          blockThreads.some((t) => t.id === this.activeId),
        );
        el.dataset.mdcThreads = blockThreads.map((t) => t.id).join(' ');
      }
    }
  }

  /** 编辑视图：用磁盘源码定位，再按行列换算到 CodeMirror offset（CodeMirror 把 CRLF 归一成 \n）。 */
  private async refreshEditor(view: MarkdownView, file: TFile): Promise<void> {
    const cm = editorViewOf(view);
    if (!cm) {
      return;
    }
    const { editor } = view;
    const text = pickSourceText(editor.getValue(), await this.plugin.app.vault.cachedRead(file));
    const starts = lineStarts(text);
    const toOffset = (offset: number): number => {
      const pos = positionAt(text, starts, offset);
      return editor.posToOffset({ line: pos.line, ch: pos.character });
    };
    const marks: EditorMark[] = this.locatedThreads(file, text).map(({ thread, range }) => ({
      from: toOffset(range.start),
      to: toOffset(range.end),
      threadId: thread.id,
      resolved: thread.status === 'resolved',
      active: thread.id === this.activeId,
    }));
    applyEditorMarks(cm, marks);
  }

  private onClick(e: MouseEvent): void {
    if (window.getSelection()?.isCollapsed === false || !(e.target instanceof HTMLElement)) {
      return;
    }
    const mark = e.target.closest<HTMLElement>('.mdc-mark');
    if (mark?.dataset.threadId) {
      this.select(mark.dataset.threadId);
      this.plugin.focusThread(mark.dataset.threadId);
      return;
    }
    const section = e.target.closest<HTMLElement>('.mdc-section-marked');
    const id = section?.dataset.mdcThreads?.split(' ')[0];
    if (section && id && !e.target.closest('a, button')) {
      this.select(id);
      this.plugin.focusThread(id);
    }
  }

  /** 选中线程：加深它的高亮（其余恢复常态）。 */
  select(threadId: string | null): void {
    if (this.activeId !== threadId) {
      this.activeId = threadId;
      this.scheduleRefresh();
    }
  }

  /** 侧栏点卡片 → 选中该线程，并把阅读视图 / 编辑视图滚到对应位置。 */
  revealThread(threadId: string): void {
    this.select(threadId);
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const { view } = leaf;
      if (!(view instanceof MarkdownView) || !view.file) {
        continue;
      }
      if (view.getMode() === 'preview') {
        const hit = Array.from(
          view.previewMode.containerEl.querySelectorAll<HTMLElement>('.mdc-mark, .mdc-section-marked'),
        ).find(
          (el) => el.dataset.threadId === threadId || el.dataset.mdcThreads?.split(' ').includes(threadId),
        );
        hit?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        this.plugin.run(this.scrollEditorTo(view, view.file, threadId));
      }
    }
  }

  private async scrollEditorTo(view: MarkdownView, file: TFile, threadId: string): Promise<void> {
    const text = pickSourceText(view.editor.getValue(), await this.plugin.app.vault.cachedRead(file));
    const hit = this.locatedThreads(file, text).find((l) => l.thread.id === threadId);
    if (!hit) {
      return;
    }
    const starts = lineStarts(text);
    const from = positionAt(text, starts, hit.range.start);
    const to = positionAt(text, starts, hit.range.end);
    view.editor.scrollIntoView(
      { from: { line: from.line, ch: from.character }, to: { line: to.line, ch: to.character } },
      true,
    );
  }
}

/** Obsidian 的 Editor 包着 CodeMirror 6 的 EditorView（`editor.cm`，未写进公开 d.ts）。 */
function editorViewOf(view: MarkdownView): EditorView | null {
  const {cm} = (view.editor as unknown as { cm?: EditorView });
  return typeof cm?.dispatch === 'function' ? cm : null;
}
