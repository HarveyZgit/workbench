// Obsidian 适配器入口：markdown-comment 的第四个客户端（CLI、VS Code、Skill 之外）。
// 线程模型、存储目录、CLI、Skill 全部复用，这里只做 Obsidian 的交互与展示。
import { randomUUID } from 'node:crypto';
import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { formatSkillPrompt } from '../../storage';
import type { StoredThread } from '../../types';
import type { Draft } from './draft';
import { documentDraft, draftFromEditorBlock, draftFromEditorSelection } from './editing';
import { formatBody } from './model';
import { ReadingController } from './reading';
import { CommentSettingTab, DEFAULT_SETTINGS } from './settings';
import type { CommentSettings } from './settings';
import { CommentView, VIEW_TYPE } from './sidebar-view';
import { CommentStore, docKeyOf } from './store';

const WATCH_DEBOUNCE_MS = 150;
const MODIFY_DEBOUNCE_MS = 400;

export default class MarkdownCommentPlugin extends Plugin {
  settings: CommentSettings = { ...DEFAULT_SETTINGS };
  store!: CommentStore;
  reading!: ReadingController;
  currentFile: TFile | null = null;
  draft: Draft | null = null;
  private watchTimer: number | undefined;
  private modifyTimer: number | undefined;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.store = new CommentStore(() => this.settings.storageDir);
    this.reading = new ReadingController(this);

    this.registerView(VIEW_TYPE, (leaf) => new CommentView(leaf, this));
    this.addSettingTab(new CommentSettingTab(this.app, this));
    this.reading.register();
    this.registerCommands();

    const { workspace, vault } = this.app;
    this.registerEvent(workspace.on('active-leaf-change', () => this.syncActiveFile()));
    this.registerEvent(workspace.on('file-open', () => this.syncActiveFile()));
    this.registerEvent(workspace.on('layout-change', () => this.reading.scheduleRefresh()));
    this.registerEvent(
      vault.on('modify', (file) => {
        if (file.path === this.currentFile?.path) {
          window.clearTimeout(this.modifyTimer);
          this.modifyTimer = window.setTimeout(() => this.dataChanged(), MODIFY_DEBOUNCE_MS);
        }
      }),
    );
    workspace.onLayoutReady(() => {
      this.syncActiveFile();
      this.startWatch();
    });
  }

  onunload(): void {
    window.clearTimeout(this.watchTimer);
    window.clearTimeout(this.modifyTimer);
    this.store.stopWatch();
    this.reading.destroy();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.startWatch();
    this.dataChanged();
  }

  // ─── 基础设施 ────────────────────────────────────────────────

  /** 吞掉并提示异步操作里的异常，避免静默失败。 */
  run(task: Promise<unknown>): void {
    task.catch((err: unknown) => {
      new Notice(`Markdown Comment：${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** 文档键 = vault 根绝对路径 + 笔记路径，与 VS Code 的 fsPath 一致。 */
  keyOf(file: TFile): string | null {
    const { adapter } = this.app.vault;
    return adapter instanceof FileSystemAdapter ? docKeyOf(adapter.getBasePath(), file.path) : null;
  }

  readText(file: TFile): Promise<string> {
    return this.app.vault.read(file);
  }

  private ensureStore(file: TFile): string | null {
    const key = this.keyOf(file);
    if (!key) {
      new Notice('Markdown Comment 仅支持本地磁盘上的 vault');
      return null;
    }
    if (!this.store.dir()) {
      new Notice('未找到评论存储目录：请在「设置 → Markdown Comment」里填写存储目录。');
      return null;
    }
    return key;
  }

  private startWatch(): void {
    this.store.startWatch(() => {
      window.clearTimeout(this.watchTimer);
      this.watchTimer = window.setTimeout(() => this.dataChanged(), WATCH_DEBOUNCE_MS);
    });
  }

  syncActiveFile(): void {
    // 侧栏自己获得焦点时没有活动 MarkdownView，getActiveFile 仍给出最近一次打开的笔记。
    const file =
      this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.app.workspace.getActiveFile();
    if (file?.extension === 'md') {
      if (file.path !== this.currentFile?.path) {
        this.currentFile = file;
        this.refreshSidebars();
      }
    } else if (this.currentFile && !this.app.vault.getAbstractFileByPath(this.currentFile.path)) {
      this.currentFile = null;
      this.refreshSidebars();
    }
  }

  private sidebars(): CommentView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is CommentView => view instanceof CommentView);
  }

  private refreshSidebars(): void {
    this.sidebars().forEach((v) => v.refresh());
  }

  /** 评论数据变了（自己写 / CLI / VS Code 写）：刷新侧栏与阅读视图高亮。 */
  dataChanged(): void {
    this.refreshSidebars();
    this.reading.scheduleRefresh();
  }

  async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) {
        return;
      }
      await right.setViewState({ type: VIEW_TYPE, active: true });
      leaf = right;
    }
    await workspace.revealLeaf(leaf);
  }

  focusThread(threadId: string): void {
    this.run(
      this.openSidebar().then(() => {
        this.sidebars().forEach((v) => v.focusThread(threadId));
      }),
    );
  }

  // ─── 草稿与线程操作 ──────────────────────────────────────────

  startDraft(draft: Draft): void {
    if (!this.ensureStore(draft.file)) {
      return;
    }
    this.draft = draft;
    this.currentFile = draft.file;
    this.run(
      this.openSidebar().then(() => {
        this.sidebars().forEach((v) => v.focusDraft());
      }),
    );
  }

  cancelDraft(): void {
    this.draft = null;
    this.refreshSidebars();
  }

  async submitDraft(): Promise<void> {
    const { draft } = this;
    if (!draft) {
      return;
    }
    const body = formatBody(draft.label, draft.body);
    if (!draft.body.trim()) {
      new Notice('评论内容不能为空');
      return;
    }
    const key = this.ensureStore(draft.file);
    if (!key) {
      return;
    }
    const anchor = draft.build(draft.sourceText ?? (await this.readText(draft.file)));
    if (!anchor) {
      new Notice('无法把选区定位回源码，评论未保存');
      return;
    }
    const thread: StoredThread = {
      id: randomUUID(),
      anchor,
      status: 'open',
      comments: [{ id: randomUUID(), author: 'user', body, createdAt: new Date().toISOString() }],
    };
    this.store.mutate(key, (d) => d.threads.push(thread));
    this.draft = null;
    this.dataChanged();
  }

  private mutateThread(
    file: TFile,
    threadId: string,
    fn: (t: StoredThread, all: StoredThread[]) => void,
  ): void {
    const key = this.keyOf(file);
    if (!key) {
      return;
    }
    this.store.mutate(key, (d) => {
      const thread = d.threads.find((t) => t.id === threadId);
      if (thread) {
        fn(thread, d.threads);
      }
    });
    this.dataChanged();
  }

  replyTo(file: TFile, threadId: string, body: string): void {
    this.mutateThread(file, threadId, (t) => {
      t.comments.push({ id: randomUUID(), author: 'user', body, createdAt: new Date().toISOString() });
    });
  }

  editComment(file: TFile, threadId: string, commentId: string, body: string): void {
    this.mutateThread(file, threadId, (t) => {
      const c = t.comments.find((x) => x.id === commentId);
      if (c) {
        c.body = body;
      }
    });
  }

  /** 同 VS Code 预览：评论删空了，整条线程一并移除。 */
  deleteComment(file: TFile, threadId: string, commentId: string): void {
    this.mutateThread(file, threadId, (t, all) => {
      t.comments = t.comments.filter((c) => c.id !== commentId);
      if (t.comments.length === 0) {
        all.splice(all.indexOf(t), 1);
      }
    });
  }

  setResolved(file: TFile, threadId: string, resolved: boolean): void {
    this.mutateThread(file, threadId, (t) => {
      t.status = resolved ? 'resolved' : 'open';
    });
  }

  deleteThread(file: TFile, threadId: string): void {
    this.mutateThread(file, threadId, (t, all) => {
      all.splice(all.indexOf(t), 1);
    });
  }

  // ─── 命令 ────────────────────────────────────────────────────

  addDocumentComment(): void {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.currentFile;
    if (file) {
      this.startDraft(documentDraft(file));
    }
  }

  async copySkillPrompt(): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.currentFile;
    const key = file ? this.keyOf(file) : null;
    if (!key) {
      new Notice('请先打开一篇本地 Markdown 笔记');
      return;
    }
    await navigator.clipboard.writeText(formatSkillPrompt(key));
    new Notice('已复制 Skill 提示');
  }

  /** 仅在有活动 Markdown 视图时可用；handler 拿到该视图。 */
  private markdownCommand(
    id: string,
    name: string,
    handler: (view: MarkdownView) => Promise<void> | void,
  ): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          return false;
        }
        if (!checking) {
          this.run(Promise.resolve(handler(view)));
        }
        return true;
      },
    });
  }

  private registerCommands(): void {
    this.markdownCommand('add-selection-comment', '添加划词评论', async (view) => {
      if (view.getMode() === 'preview') {
        await this.reading.commentCurrentSelection();
        return;
      }
      const draft = await draftFromEditorSelection(this, view);
      if (draft) {
        this.startDraft(draft);
      }
    });
    this.markdownCommand('add-block-comment', '添加整块评论', async (view) => {
      if (view.getMode() === 'preview') {
        new Notice('阅读视图请把鼠标移到块上，点右上角的 💬 按钮');
        return;
      }
      const draft = await draftFromEditorBlock(this, view);
      if (draft) {
        this.startDraft(draft);
      }
    });
    this.markdownCommand('add-document-comment', '添加全文评论', () => this.addDocumentComment());
    this.addCommand({
      id: 'open-sidebar',
      name: '打开评论侧栏',
      callback: () => this.run(this.openSidebar()),
    });
    this.markdownCommand('copy-skill-prompt', '复制 Skill 提示', () => this.copySkillPrompt());
  }
}
