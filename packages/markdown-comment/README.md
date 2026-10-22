# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, a CLI for Agent use (`list`/`reply`/`resolve`), and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Its next refactoring phase will extract an editor-neutral core so CLI, Skills, VS Code, and future IDE or local-web adapters share one domain and storage contract.

The Skill source is kept with the package at `resources/skills/markdown-comment/SKILL.md`. The build copies it into `dist/resources/` for the VSIX (plugin install rewrites `{{CLI}}` to an absolute path) and also emits a portable copy at `dist/skill-hub/markdown-comment/` for Skill Hub / manual install.

Before changing this package, read `AGENTS.md` and `docs/architecture/markdown-comment.md` in this package.

## Comment preview

Run **Markdown Comment：打开评论预览** from a Markdown editor. The preview opens beside the source file and supports:

- rendered-text selection comments and whole-document comments;
- Mermaid diagrams with whole-diagram comments, pan, zoom, reset, source copy, and optional explicit Flowchart-node comments;
- YAML front matter, syntax-highlighted code blocks, local images, links, and KaTeX formulas;
- editor/preview scroll synchronization and double-click source navigation;
- optional sanitized HTML, local custom CSS, image copy/open actions, and unsaved rendered-diff markers;
- comment threads shared with the CLI;
- Markdown comment bodies with raw-source editing and sanitized rendering;
- multiple local image attachments, with removal and ordering before submission;
- code-copy icons in a fixed toolbar outside horizontally scrolling code.

Preview settings:

- `markdownComment.preview.frontMatter`: `table`, `codeBlock`, or `hide`;
- `markdownComment.preview.scrollPreviewWithEditor`;
- `markdownComment.preview.scrollEditorWithPreview`;
- `markdownComment.preview.doubleClickToSwitchToEditor`;
- `markdownComment.preview.styles`, `fontFamily`, `fontSize`, and `lineHeight`;
- `markdownComment.preview.breaks`, `typographer`, and `html`;
- `markdownComment.preview.renderedDiff`;
- `markdownComment.preview.mermaidNodeComments`.

## 评论正文和图片

评论提交后使用与预览区共用的 Markdown 引擎渲染，编辑时仍是原始 Markdown。评论不执行原始 HTML，并经过清洗；即使文件只在本地使用，也不会信任粘贴内容或 Agent 回复里的 HTML。评论内容不会参与文档大纲、划词锚点或源码定位。

预览侧栏的创建、回复和编辑框支持直接粘贴剪贴板中的图片（可连续粘贴，也可一次粘贴多张），也支持纯图片评论。提交前可删除图片或调整顺序；取消不会保存新图片。支持 PNG、JPEG、GIF、WebP，每条评论最多 10 张、每张最多 10 MiB、合计最多 30 MiB，服务端同时检查文件内容与类型。

图片保存在当前评论存储目录的 `attachments/` 下，不写进 Markdown 文档或项目目录，也不会上传到外部服务。文件名由系统生成，评论只保存有序的附件元数据；文档另存为或迁移存储键时不需要搬动图片。当前实现仍沿用 VS Code 全局存储及 CLI 指针兼容层，不引入新的默认存储位置。备份评论时应备份整个存储目录，包括附件。

## Install

Install the VSIX first (it ships the CLI). Then register the Skill in either way:

1. Install the extension: `code --install-extension <path-to-vscode-markdown-comment.vsix> --force`
2. **Plugin install:** command palette (⇧⌘P) → **Markdown Comment：安装 / 更新 Agent Skill**. Pick one or more Agent directories (multi-select). The list combines already-installed targets, skill roots auto-detected under your home directory, and a few common host seeds; you can also add a custom directory. Each selected root gets a `markdown-comment` symlink pointing at the extension's resolved Skill copy in its stable global storage, so the link keeps working across extension upgrades. Already-installed targets are refreshed/migrated to the latest version.
3. **Self-install / Skill Hub:** copy `dist/skill-hub/markdown-comment/` into an Agent skills directory (for example `~/.agents/skills/markdown-comment`). Upload that same folder to Skill Hub for others. The portable Skill locates the CLI from PATH, `MARKDOWN_COMMENT_CLI`, or the installed editor extension.
4. (Optional) **Markdown Comment：移除 Agent Skill** — select recorded plugin-installs to remove. It only deletes the symlinks this extension created and never touches other files or a Skill Hub copy.

Symlinks target a canonical Skill copy in the extension's global storage rather than the versioned extension directory, which VS Code renames on every upgrade. The extension reconciles these links on activation, repairing them after an upgrade and dropping records whose target was replaced by hand.

> VS Code has no uninstall hook, so the extension cannot self-clean when it is removed. Run **移除 Agent Skill** before uninstalling. If a dangling link is left behind, that command (or a manual delete) clears it.

## Development

From the repository root:

```sh
rush typecheck --to vscode-markdown-comment
rush build --to vscode-markdown-comment
```

Pack the VSIX from the package directory:

```sh
(cd packages/markdown-comment && rushx package)
```

### 代码块语言标签

预览和评论中的代码块在左上角显示语言，右上角提供自动换行开关和复制按钮；横向滚动只移动代码。优先使用围栏声明的语言（支持别名；未支持高亮的语言仍显示声明的名称）。未声明时尝试保守识别；短内容、结果不明确或超过 10,000 字符时显示 `txt`。显式 `txt` / `text` / `plaintext` 不触发识别。自动识别是启发式判断；需要准确标记时请写明围栏语言。换行只改变显示，不修改源码；复制仅包含原始代码，不包含标签。正文和评论中的选中文本可用 Cmd/Ctrl+C 或右键「复制所选文字」复制。

## 交互回归测试

在构建后运行合成 DOM 与浏览器检查（不等同于 VS Code 宿主测试）：

```sh
JSDOM_MODULE=/path/to/jsdom node packages/markdown-comment/tests/webview-dom.mjs
JSDOM_MODULE=/path/to/jsdom node packages/markdown-comment/tests/code-wrap-dom.mjs
JSDOM_MODULE=/path/to/jsdom node packages/markdown-comment/tests/selection-copy-dom.mjs
JSDOM_MODULE=/path/to/jsdom node --test packages/markdown-comment/tests/attachment-composer-dom.mjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node packages/markdown-comment/tests/webview-browser.mjs
```

在仓库根目录执行上述命令。`JSDOM_MODULE` 和 `PLAYWRIGHT_MODULE` 指向测试环境安装的模块；浏览器检查覆盖工具栏布局与实际换行。

## 自动发布 GitHub Release

`.github/workflows/markdown-comment-release.yml` 在 PR 合入 `master`（或直接推送到 `master`）后，根据本包 `package.json` 的 `version` 发布正式版。版本号只接受 `x.y.z`；要发布修复时，在同一个 PR 中把版本号递增，例如 `1.7.0` → `1.7.1`。不需要手动打 tag。版本不变且对应 tag / Release 已存在时跳过；其他包的无关修改不会触发。

流程先用 Node 22 和 Rush 锁定依赖，执行类型检查、生产构建、单元测试、VSIX 打包，再创建 `markdown-comment-v<version>` 和附件 `vscode-markdown-comment-<version>.vsix`。Release 说明来自上一个 Markdown Comment 版本之后的本包提交。PR 阶段也执行构建验证，但不会发布。合入自动发布工作流本身不会重新发布已有的 `1.7.0`。

发布 job 单独使用临时 `GITHUB_TOKEN` 的 `contents: write` 权限；构建 job 只有读取权限，不需要 PAT、Marketplace token 或新增 secret，也不修改仓库设置。这里只发布 GitHub Release，不发布 VS Code Marketplace / npm。先上传到内部草稿，附件完整后才公开为非预发布正式版并标记 Latest；较旧版本的延迟重试不会覆盖本包更新的 Latest。

失败时在 GitHub Actions 对原运行选择 **Re-run all jobs**。网络、权限或 API 错误会直接失败，不会当作“版本不存在”。同一提交留下的工作流草稿可以继续上传；已有正式版、已有独立 tag 或人工创建的草稿不会被覆盖。其他提交留下的同名草稿需要维护者先检查，不能通过重跑改写其内容。发布 job 串行执行，并使用 GitHub concurrency 的 `queue: max` 保留最多 100 个待执行发布任务，避免重复发布或连续合并时挤掉待发布版本。

发布脚本自身的无网络回归测试：

```sh
node --test scripts/markdown-comment-release.test.mjs
```

CI 的单元测试不代替上文合成浏览器测试或真实 VS Code 宿主验证；UI 改动仍需运行相应回归。
