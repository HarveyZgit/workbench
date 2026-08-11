# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, the `markdown-comment` / `mdc` CLI, and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Its next refactoring phase will extract an editor-neutral core so CLI, Skills, VS Code, and future IDE or local-web adapters share one domain and storage contract.

The Skill source is kept with the package at `resources/skills/markdown-comment/SKILL.md`. The build copies it into `dist/resources/` so `mdc init` and the packaged VSIX remain self-contained. It is installed only through this package and is not published with the repository's standalone workflow Skills.

Before changing this package, read `AGENTS.md` and `docs/architecture/markdown-comment.md` in this package.

## Comment preview

Run **Markdown 评论：打开评论预览** from a Markdown editor. The preview opens beside the source file and supports:

- rendered-text selection comments and whole-document comments;
- Mermaid diagrams with whole-diagram comments, pan, zoom, reset, source copy, and optional explicit Flowchart-node comments;
- YAML front matter, syntax-highlighted code blocks, local images, links, and KaTeX formulas;
- editor/preview scroll synchronization and double-click source navigation;
- optional sanitized HTML, local custom CSS, image copy/open actions, and unsaved rendered-diff markers;
- comment threads shared with the `mdc` CLI.

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

`mdc init` does not assume a particular Agent host or skill directory. Pass the target explicitly:

```sh
mdc init --skill-dir <full-skill-directory>
mdc init --skill-dirs <skill-root-a,skill-root-b>
```

`--skill-dir` points to the final `markdown-comment` directory. Each entry in
`--skill-dirs` is a skill root; the command creates a `markdown-comment`
subdirectory under it. Interactive use prompts for these roots, while
non-interactive use must provide one of the flags or use `--no-skill`.

Targets are canonicalized before writing. If multiple paths ultimately resolve
to the same directory (for example one skill root is a symlink to another), the
Skill is written once and duplicate targets are reported. The installed Skill
always invokes this package's bundled CLI instead of trusting an unrelated
global `mdc` command.

The package `setup` script forwards arguments to `mdc init`. From the repository
root, pass the target explicitly in non-interactive environments:

```sh
emo run setup --filter './packages/markdown-comment' -- --skill-dir <full-skill-directory>
```

## Development

From the repository root:

```sh
emo run check --filter './packages/markdown-comment'
emo run build --filter './packages/markdown-comment'
```
