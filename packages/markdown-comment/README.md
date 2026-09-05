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

Repository releases are private; anonymous download 404s. Use a logged-in GitHub CLI to fetch the tarball, then install globally and register the Skill:

```sh
gh release download markdown-comment-v1.2.1 --repo HarveyZgit/workbench -p 'vscode-markdown-comment-*.tgz'
npm install -g ./vscode-markdown-comment-1.2.1.tgz
markdown-comment install-skill
markdown-comment extension
```

Run markdown-comment extension to print the absolute VSIX path and a short code --install-extension hint. Install the VSIX manually.

Source-tree development:

```sh
cd packages/markdown-comment
rushx build
node dist/cli.js install-skill
```

Pack the Release tarball and VSIX (artifacts under dist/):

```sh
cd packages/markdown-comment
rushx pack-release
```

## CLI

```sh
markdown-comment install-skill [--target <skill-root>]
markdown-comment extension
markdown-comment list [file] [-g] [--open] [--name-only] [--hidden] [--json]
markdown-comment reply <threadId> <text>
markdown-comment resolve <threadId>
markdown-comment preview <file.md> [--port 8765] [--no-open] [--detach]
```

preview opens a generic local browser preview (HTTP + WebSocket) against the same comment store, not editor-specific. --detach starts the server in the background and returns once the URL is ready.

Comment data defaults to ~/.markdown-comment/store (pointer at ~/.markdown-comment/pointer.json). Override with MARKDOWN_COMMENT_STORAGE_DIR. The CLI bootstraps storage on first use; VS Code is not required.

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
