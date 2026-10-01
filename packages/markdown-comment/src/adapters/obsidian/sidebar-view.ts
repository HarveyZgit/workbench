// 右侧栏：跟随当前笔记，展示 / 回复 / 解决 / 删除线程，并承载新评论草稿。
// 结构与样式对齐 VS Code 预览侧栏（webview.ts 的 cardHtml / renderDraft、panel.ts 的侧栏 CSS）。
import { ItemView, Platform, sanitizeHTMLToDom, setTooltip } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import {
  ICON_ADD_DOC,
  ICON_COPY_SKILL,
  ICON_DELETE,
  ICON_EDIT,
  ICON_RESOLVE,
  ICON_SEND,
  ICON_SOURCE,
  authorName,
  relativeTime,
} from '../../preview/card-ui';
import type { StoredDocument, StoredThread } from '../../types';
import type MarkdownCommentPlugin from './main';
import { LABELS, formatBody, isOrphaned, parseLabel, quoteLabel } from './model';

export const VIEW_TYPE = 'markdown-comment';

type Tab = 'open' | 'resolved' | 'all';

const TAB_NAMES: Record<Tab, string> = { open: '未解决', resolved: '已解决', all: '全部' };
const EMPTY_TEXT: Record<Tab, string> = {
  open: '没有未解决的评论 🎉',
  resolved: '没有已解决的评论',
  all: '还没有评论。在正文里划词试试。',
};
const CONFIRM_RESET_MS = 3000;
const SUBMIT_KEY = Platform.isMacOS ? 'Cmd' : 'Ctrl';

function iconButton(parent: HTMLElement, svg: string, tip: string, cls = ''): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: `mdc-icon ${cls}`.trim(), attr: { type: 'button' } });
  btn.append(sanitizeHTMLToDom(svg));
  setTooltip(btn, tip);
  return btn;
}

function isSubmit(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter';
}

export class CommentView extends ItemView {
  private tab: Tab = 'open';
  private activeId: string | null = null;
  private focusKeyNext: string | null = null;
  private editing: { commentId: string; value: string } | null = null;
  private renderToken = 0;
  private readonly replyDrafts = new Map<string, string>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: MarkdownCommentPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '评论';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('mdc-view');
    this.plugin.syncActiveFile();
    await this.render();
  }

  /** 草稿刚创建：渲染后把焦点放进草稿输入框。 */
  focusDraft(): void {
    this.focusKeyNext = 'draft';
    this.refresh();
  }

  /** 阅读视图点了高亮：切到包含该线程的标签、滚到卡片。 */
  focusThread(threadId: string): void {
    this.activeId = threadId;
    this.refresh(true);
  }

  refresh(scrollToActive = false): void {
    this.render(scrollToActive).catch(() => undefined);
  }

  private async render(scrollToActive = false): Promise<void> {
    const token = ++this.renderToken;
    const { currentFile: file } = this.plugin;
    const key = file ? this.plugin.keyOf(file) : null;
    const text = file ? await this.plugin.app.vault.cachedRead(file) : '';
    if (token !== this.renderToken) {
      return;
    }
    const focus = this.captureFocus();
    const root = this.contentEl;
    root.empty();

    if (!file || !key) {
      root.createDiv({ cls: 'mdc-empty', text: '打开一篇 Markdown 笔记后，在这里查看和添加评论。' });
      return;
    }
    if (!this.plugin.store.dir()) {
      root.createDiv({
        cls: 'mdc-empty',
        text: '未找到评论存储目录。请在「设置 → Markdown Comment」里填写存储目录。',
      });
      return;
    }
    const doc = this.plugin.store.load(key);
    // 从正文跳过来的线程若不在当前标签里，切到「全部」，避免卡片找不到；用户自己切标签时不干预。
    const active = scrollToActive ? doc.threads.find((t) => t.id === this.activeId) : undefined;
    if (active && this.tab !== 'all' && active.status !== this.tab) {
      this.tab = 'all';
    }
    this.renderHead(root, doc);
    if (this.plugin.draft?.file.path === file.path) {
      this.renderDraft(root);
    }
    this.renderThreads(root, file, doc, text);
    this.restoreFocus(focus);
    if (scrollToActive) {
      this.scrollToActiveCard();
    }
  }

  // ─── 焦点保持（外部写入触发的重渲染不能抢走正在输入的光标）──────────────

  private captureFocus(): { key: string; start: number } | null {
    const active = this.contentEl.ownerDocument.activeElement;
    if (active instanceof HTMLTextAreaElement && active.dataset.key && this.contentEl.contains(active)) {
      return { key: active.dataset.key, start: active.selectionStart };
    }
    return null;
  }

  private restoreFocus(focus: { key: string; start: number } | null): void {
    const wanted = this.focusKeyNext ?? focus?.key;
    this.focusKeyNext = null;
    if (!wanted) {
      return;
    }
    const el = Array.from(this.contentEl.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
      (t) => t.dataset.key === wanted,
    );
    if (el) {
      el.focus();
      const pos = focus && focus.key === wanted ? focus.start : el.value.length;
      el.setSelectionRange(pos, pos);
    }
  }

  private scrollToActiveCard(): void {
    const card = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.mdc-card')).find(
      (c) => c.dataset.threadId === this.activeId,
    );
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── 区块 ────────────────────────────────────────────────────

  private renderHead(root: HTMLElement, doc: StoredDocument): void {
    const counts: Record<Tab, number> = {
      open: doc.threads.filter((t) => t.status === 'open').length,
      resolved: doc.threads.filter((t) => t.status === 'resolved').length,
      all: doc.threads.length,
    };
    const head = root.createDiv({ cls: 'mdc-head' });
    const tabs = head.createDiv({ cls: 'mdc-tabs' });
    for (const tab of Object.keys(TAB_NAMES) as Tab[]) {
      const btn = tabs.createEl('button', { cls: tab === this.tab ? 'mdc-tab is-active' : 'mdc-tab' });
      btn.createSpan({ text: TAB_NAMES[tab] });
      if (counts[tab] > 0) {
        btn.createSpan({ cls: 'mdc-tab-n', text: String(counts[tab]) });
      }
      btn.addEventListener('click', () => {
        this.tab = tab;
        this.refresh();
      });
    }
    const actions = head.createDiv({ cls: 'mdc-head-actions' });
    iconButton(actions, ICON_ADD_DOC, '全文评论').addEventListener('click', () =>
      this.plugin.addDocumentComment(),
    );
    iconButton(actions, ICON_COPY_SKILL, '复制 Skill 提示').addEventListener('click', () => {
      this.plugin.run(this.plugin.copySkillPrompt());
    });
  }

  private renderDraft(root: HTMLElement): void {
    const { draft } = this.plugin;
    if (!draft) {
      return;
    }
    const box = root.createDiv({ cls: 'mdc-draft' });
    box.createDiv({ cls: 'mdc-card-quote', text: draft.preview });
    const input = box.createEl('textarea', {
      cls: 'mdc-draft-input',
      attr: { placeholder: `写下你的评论…（${SUBMIT_KEY}+Enter 提交，Esc 取消）`, 'data-key': 'draft' },
    });
    input.value = draft.body;
    input.addEventListener('input', () => {
      draft.body = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (isSubmit(e)) {
        e.preventDefault();
        this.plugin.run(this.plugin.submitDraft());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.plugin.cancelDraft();
      }
    });
    const row = box.createDiv({ cls: 'mdc-card-actions' });
    const select = row.createEl('select', { cls: 'dropdown mdc-label-select' });
    select.createEl('option', { text: '无标签', value: '' });
    for (const label of LABELS) {
      select.createEl('option', { text: label, value: label });
    }
    select.value = draft.label ?? '';
    select.addEventListener('change', () => {
      draft.label = select.value || null;
    });
    row.createEl('button', { text: '取消' }).addEventListener('click', () => this.plugin.cancelDraft());
    row.createEl('button', { text: '评论', cls: 'mod-cta' }).addEventListener('click', () => {
      this.plugin.run(this.plugin.submitDraft());
    });
  }

  private renderThreads(root: HTMLElement, file: TFile, doc: StoredDocument, text: string): void {
    const threads = doc.threads
      .filter((t) => this.tab === 'all' || t.status === this.tab)
      .sort((a, b) => a.anchor.startLine - b.anchor.startLine);
    const list = root.createDiv({ cls: 'mdc-list' });
    if (threads.length === 0) {
      list.createDiv({ cls: 'mdc-empty', text: EMPTY_TEXT[this.tab] });
      return;
    }
    for (const thread of threads) {
      this.renderCard(list, file, thread, isOrphaned(text, thread.anchor));
    }
  }

  private renderCard(list: HTMLElement, file: TFile, thread: StoredThread, orphaned: boolean): void {
    const resolved = thread.status === 'resolved';
    const card = list.createDiv({ cls: 'mdc-card' });
    card.toggleClass('resolved', resolved);
    card.toggleClass('orphaned', orphaned);
    card.toggleClass('active', thread.id === this.activeId);
    card.dataset.threadId = thread.id;
    card.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('button, textarea, select')) {
        return;
      }
      this.activeId = thread.id;
      this.plugin.reading.revealThread(thread.id);
      this.contentEl.querySelectorAll('.mdc-card.active').forEach((c) => c.removeClass('active'));
      card.addClass('active');
    });

    const first = thread.comments[0] ? parseLabel(thread.comments[0].body) : { label: null, text: '' };
    const head = card.createDiv({ cls: 'mdc-card-head' });
    const quote = head.createDiv({ cls: 'mdc-card-quote' });
    if (orphaned) {
      quote.createSpan({ cls: 'mdc-orphaned-tag', text: '失联' });
    }
    if (first.label) {
      quote.createSpan({ cls: 'mdc-chip', text: first.label });
    }
    quote.appendText(quoteLabel(thread.anchor));

    const tools = head.createDiv({ cls: 'mdc-card-tools' });
    if (!orphaned && thread.anchor.kind !== 'document') {
      iconButton(tools, ICON_SOURCE, '在正文中定位').addEventListener('click', () => {
        this.plugin.reading.revealThread(thread.id);
      });
    }
    iconButton(
      tools,
      ICON_RESOLVE,
      resolved ? '重新打开' : '标记已解决',
      resolved ? 'resolve on' : 'resolve',
    ).addEventListener('click', () => this.plugin.setResolved(file, thread.id, !resolved));
    const del = iconButton(tools, ICON_DELETE, '删除整条评论', 'delete');
    del.addEventListener('click', () => {
      if (del.dataset.confirm) {
        this.plugin.deleteThread(file, thread.id);
        return;
      }
      del.dataset.confirm = '1';
      del.addClass('confirm');
      setTooltip(del, '再点一次确认删除');
      window.setTimeout(() => {
        delete del.dataset.confirm;
        del.removeClass('confirm');
        setTooltip(del, '删除整条评论');
      }, CONFIRM_RESET_MS);
    });

    const comments = card.createDiv({ cls: 'mdc-card-comments' });
    thread.comments.forEach((c, i) => {
      const item = comments.createDiv({ cls: 'mdc-cmt' });
      const meta = item.createDiv({ cls: 'mdc-cmt-head' });
      meta.createSpan({
        cls: c.author === 'agent' ? 'mdc-author agent' : 'mdc-author',
        text: authorName(c.author),
      });
      meta.createSpan({ cls: 'mdc-time', text: relativeTime(c.createdAt) });
      // 第一条评论的标签前缀只显示成 chip；编辑时只改正文，保存时把原标签拼回去。
      const label = i === 0 ? first.label : null;
      const text = i === 0 ? first.text : c.body;
      const cmtTools = meta.createSpan({ cls: 'mdc-cmt-tools' });
      iconButton(cmtTools, ICON_EDIT, '编辑这条评论').addEventListener('click', () => {
        this.editing = { commentId: c.id, value: text };
        this.focusKeyNext = `edit:${c.id}`;
        this.refresh();
      });
      iconButton(cmtTools, ICON_DELETE, '删除这条评论').addEventListener('click', () => {
        this.plugin.deleteComment(file, thread.id, c.id);
      });
      if (this.editing?.commentId === c.id) {
        this.renderEdit(item, file, thread.id, c.id, label);
      } else {
        item.createDiv({ cls: 'mdc-body', text });
      }
    });

    this.renderReply(card, file, thread);
  }

  /** 行内编辑已发出的评论：回车换行，Cmd/Ctrl+回车 保存，Esc 取消（同 VS Code 预览）。 */
  private renderEdit(
    item: HTMLElement,
    file: TFile,
    threadId: string,
    commentId: string,
    label: string | null,
  ): void {
    const {editing} = this;
    if (!editing) {
      return;
    }
    const form = item.createDiv({ cls: 'mdc-edit' });
    const input = form.createEl('textarea', {
      cls: 'mdc-edit-input',
      attr: { 'data-key': `edit:${commentId}` },
    });
    input.value = editing.value;
    input.addEventListener('input', () => {
      editing.value = input.value;
    });
    const cancel = (): void => {
      this.editing = null;
      this.refresh();
    };
    const save = (): void => {
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      this.editing = null;
      this.plugin.editComment(file, threadId, commentId, formatBody(label, text));
    };
    input.addEventListener('keydown', (e) => {
      if (isSubmit(e)) {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    const row = form.createDiv({ cls: 'mdc-card-actions' });
    row.createEl('button', { text: '取消' }).addEventListener('click', cancel);
    row.createEl('button', { text: '保存', cls: 'mod-cta' }).addEventListener('click', save);
  }

  private renderReply(card: HTMLElement, file: TFile, thread: StoredThread): void {
    const key = `reply:${thread.id}`;
    const box = card.createDiv({ cls: 'mdc-card-reply' });
    const input = box.createEl('textarea', {
      cls: 'mdc-reply',
      attr: { rows: '1', placeholder: `回复…（回车换行，${SUBMIT_KEY}+回车 发送）`, 'data-key': key },
    });
    input.value = this.replyDrafts.get(thread.id) ?? '';
    input.addEventListener('input', () => this.replyDrafts.set(thread.id, input.value));
    const send = (): void => {
      const body = input.value.trim();
      if (body) {
        this.replyDrafts.delete(thread.id);
        this.plugin.replyTo(file, thread.id, body);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (isSubmit(e)) {
        e.preventDefault();
        send();
      }
    });
    iconButton(box, ICON_SEND, `发送（${SUBMIT_KEY}+回车）`, 'mdc-send').addEventListener('click', send);
  }
}
