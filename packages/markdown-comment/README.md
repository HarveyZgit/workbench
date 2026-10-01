# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, an Obsidian plugin, a CLI for Agent use (`list`/`reply`/`resolve`), and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Anchoring already lives in an editor-neutral core (`src/core/anchor.ts`, plain text + offsets); the VS Code extension and the Obsidian plugin are adapters over it, and the next refactoring phase moves the remaining domain and storage code behind the same boundary.

The Skill source is kept with the package at `resources/skills/markdown-comment/SKILL.md`. The build copies it into `dist/resources/` for the VSIX (plugin install rewrites `{{CLI}}` to an absolute path) and also emits a portable copy at `dist/skill-hub/markdown-comment/` for Skill Hub / manual install.

Before changing this package, read `AGENTS.md` and `docs/architecture/markdown-comment.md` in this package.

## Comment preview

Run **Markdown Comment：打开评论预览** from a Markdown editor. The preview opens beside the source file and supports:

- rendered-text selection comments and whole-document comments;
- Mermaid diagrams with whole-diagram comments, pan, zoom, reset, source copy, and optional explicit Flowchart-node comments;
- YAML front matter, syntax-highlighted code blocks, local images, links, and KaTeX formulas;
- editor/preview scroll synchronization and double-click source navigation;
- optional sanitized HTML, local custom CSS, image copy/open actions, and unsaved rendered-diff markers;
- comment threads shared with the CLI.

Preview settings:

- `markdownComment.preview.frontMatter`: `table`, `codeBlock`, or `hide`;
- `markdownComment.preview.scrollPreviewWithEditor`;
- `markdownComment.preview.scrollEditorWithPreview`;
- `markdownComment.preview.doubleClickToSwitchToEditor`;
- `markdownComment.preview.styles`, `fontFamily`, `fontSize`, and `lineHeight`;
- `markdownComment.preview.breaks`, `typographer`, and `html`;
- `markdownComment.preview.renderedDiff`;
- `markdownComment.preview.mermaidNodeComments`.

## Obsidian

The Obsidian plugin is a fourth client of the same threads: it reads and writes the same store as the CLI and the VS Code extension (`docs/<sha1(absolute path)>.json` + `index.json`, schema unchanged), so a note opened in VS Code and in Obsidian shows one set of threads, and an Agent that runs `markdown-comment list --open` in the vault sees comments left in Obsidian. Desktop only (it uses Node `fs`).

Features:

- reading view: select text and click the floating **💬 评论** button, or hover a block (image, table, callout, …) and click the **💬** button at its top-right to comment on the whole block;
- highlights in both reading view and editing view (CodeMirror decorations); selecting a card keeps its highlight emphasized and scrolls the note to it;
- editing view / source mode: a mouse selection shows the same floating **💬 评论** button; commands **添加划词评论** and **添加整块评论** use the editor selection or the block at the cursor;
- command **添加全文评论**, **打开评论侧栏**, **复制 Skill 提示** (copies `/markdown-comment <absolute path>`);
- right sidebar (same card layout as the VS Code preview): 未解决 / 已解决 / 全部 tabs, reply, edit / delete a single comment (deleting the last one removes the thread), resolve / reopen, delete thread, label chips, `失联` marker for threads whose quote no longer exists; replies written by the CLI or an Agent show up in the sidebar without a reload (`fs.watch` on the store);
- labels (`不清楚` / `有误` / `删` / `其他`) are stored as a `[label] ` prefix of the first comment body, so the CLI shows them without any schema change.

Storage directory resolution: `MARKDOWN_COMMENT_STORAGE_DIR` → `~/.markdown-comment/pointer.json` → the plugin setting **存储目录**. The plugin never writes `pointer.json`; if you only use Obsidian, point the CLI at the same directory with `MARKDOWN_COMMENT_STORAGE_DIR`.

Build and install:

```sh
rush build --to vscode-markdown-comment   # emits dist/obsidian/{main.js,manifest.json,styles.css}
ln -s <repo>/packages/markdown-comment/dist/obsidian "<vault>/.obsidian/plugins/markdown-comment"
```

Then enable **Markdown Comment** under Settings → Community plugins. The Obsidian output is excluded from the VSIX (`.vscodeignore`). During development `rushx watch` rebuilds it; the Hot-Reload community plugin is optional.

Source lives in `src/adapters/obsidian/` (type-checked by `tsconfig.obsidian.json`, which adds the DOM lib that the VS Code config deliberately lacks). Pure logic (labels, orphan check, `getSectionInfo` line validation) is in `model.ts` and covered by `tests/obsidian-model.test.ts`; the Obsidian-API code has no automated tests and must be checked by hand in Obsidian.

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

Run the package tests from the package directory with `rushx test`.

Pack the VSIX from the package directory:

```sh
(cd packages/markdown-comment && rushx package)
```
