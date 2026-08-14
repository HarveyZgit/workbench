# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, a CLI for Agent use (`list`/`reply`/`resolve`), and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Its next refactoring phase will extract an editor-neutral core so CLI, Skills, VS Code, and future IDE or local-web adapters share one domain and storage contract.

The Skill source is kept with the package at `resources/skills/markdown-comment/SKILL.md`. The build copies it into `dist/resources/` so the packaged VSIX is self-contained. It is installed only through this package and is not published with the repository's standalone workflow Skills.

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

## Install

Install the VSIX, then use the command palette to register the Skill with your Agents:

1. Install the extension: `code --install-extension <path-to-vscode-markdown-comment.vsix> --force`
2. Open the command palette (⇧⌘P) and run **Markdown Comment：安装 / 更新 Agent Skill**. Pick one or more Agent directories (multi-select). The list combines already-installed targets, skill roots auto-detected under your home directory, and a few common host seeds; you can also add a custom directory. Each selected root gets a `markdown-comment` symlink pointing at the extension's resolved Skill copy in its stable global storage, so the link keeps working across extension upgrades. Already-installed targets are refreshed/migrated to the latest version.
3. (Optional) **Markdown Comment：移除 Agent Skill** — select recorded installs to remove. It only deletes the symlinks this extension created and never touches real files or foreign links.

Symlinks target a canonical Skill copy in the extension's global storage rather than the versioned extension directory, which VS Code renames on every upgrade. The extension reconciles these links on activation, repairing them after an upgrade and dropping records whose target was replaced by hand.

> VS Code has no uninstall hook, so the extension cannot self-clean when it is removed. Run **移除 Agent Skill** before uninstalling. If a dangling link is left behind, that command (or a manual delete) clears it.

## Development

From the repository root:

```sh
emo run check --filter './packages/markdown-comment'
emo run build --filter './packages/markdown-comment'
emo run package --filter './packages/markdown-comment'
```
