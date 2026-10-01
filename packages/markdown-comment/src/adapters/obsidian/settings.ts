import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type MarkdownCommentPlugin from './main';

export interface CommentSettings {
  /** 评论存储目录；仅在 MARKDOWN_COMMENT_STORAGE_DIR 与 ~/.markdown-comment/pointer.json 都没有时使用。 */
  storageDir: string;
}

export const DEFAULT_SETTINGS: CommentSettings = { storageDir: '' };

export class CommentSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: MarkdownCommentPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const resolved = this.plugin.store.dir();
    new Setting(containerEl)
      .setName('存储目录')
      .setDesc(
        [
          '评论数据目录。优先级：环境变量 MARKDOWN_COMMENT_STORAGE_DIR → ~/.markdown-comment/pointer.json → 此处。',
          '要让 CLI / Agent 看到同一份评论，请保证它们解析到同一个目录。',
          resolved ? `当前生效：${resolved}` : '当前未解析到任何目录，评论功能不可用。',
        ].join(''),
      )
      .addText((text) =>
        text
          .setPlaceholder('/path/to/markdown-comment-store')
          .setValue(this.plugin.settings.storageDir)
          .onChange(async (value) => {
            this.plugin.settings.storageDir = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
