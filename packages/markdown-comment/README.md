# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, a local browser preview (for Zed and CLI), a CLI for Agent use (`list`/`reply`/`resolve`/`preview`/`extension`), and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. CLI and the browser preview can bootstrap `~/.markdown-comment/store` without launching VS Code; an existing `pointer.json` (old globalStorage) is reused.

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

## Browser preview (Zed / CLI)

Zed has no WebView. The CLI starts an on-demand local server and opens the same comment UI in the system browser:

```sh
markdown-comment preview path/to/file.md --sync-interval 5
```

Comments are flushed to the local store every interval (default 5s), immediately on **保存**, and once more when the tab closes. Untitled documents stay on the VS Code preview path.

Print installable extension paths:

```sh
markdown-comment extension vscode   # VSIX
markdown-comment extension zed      # Zed Install Dev Extension 目录
```

Zed: **Extensions → Install Dev Extension…** → choose the printed `zed/` directory. Open a saved Markdown file, then `/mdc-preview` or the bundled task **Markdown Comment: 打开评论预览**. See `zed/README.md`.

Sync interval: `--sync-interval <seconds>`, `MARKDOWN_COMMENT_SYNC_INTERVAL`, or `~/.markdown-comment/config.json` `{ "syncIntervalSeconds": 5 }`.

## Install

Preferred CLI path — install the zero-dependency npm tarball (from `rushx pack-release` / a GitHub Release asset `markdown-comment-<ver>.tgz`):

```sh
npm install -g ./markdown-comment-1.4.0.tgz
markdown-comment extension zed      # absolute path for Zed → Install Dev Extension
markdown-comment extension vscode   # absolute path to the shipped VSIX
code --install-extension "$(markdown-comment extension vscode | head -n1)" --force
```

Or install a standalone VSIX first (it also ships `dist/cli.js`). Then register the Skill in either way:

1. Install the extension: `code --install-extension "$(markdown-comment extension vscode | head -n1)" --force`
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

Pack the VSIX or the npm CLI tarball from the package directory:

```sh
(cd packages/markdown-comment && rushx package)       # dist/vscode-markdown-comment.vsix
(cd packages/markdown-comment && rushx pack-release)  # dist/markdown-comment-<ver>.tgz (+ vsix)
```

`pack-release` stages a publish name `markdown-comment` with **empty dependencies** so `npm install -g ./markdown-comment-<ver>.tgz` works offline-ish; the tarball includes `zed/` and the VSIX for `markdown-comment extension zed|vscode`.
