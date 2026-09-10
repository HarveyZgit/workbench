# Markdown Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and this package's target [architecture](docs/architecture/markdown-comment.md) before working here.

## Current state

The current implementation has been migrated from the former standalone VS Code package. Anchors use an editor-neutral `TextModel`; CLI/browser preview can bootstrap `~/.markdown-comment/store` without launching VS Code, while an existing pointer to VS Code globalStorage is still reused. The VS Code extension remains the in-editor adapter. Treat the architecture document as the destination for further core extraction.

## Design constraints

- Start with the Markdown comment domain, never an editor API.
- Put models, anchor relocation, operations, and portable storage behind editor-neutral interfaces.
- Keep VS Code-specific code under an adapter boundary. `vscode` types must never leak into core modules.
- The CLI is a public automation interface; Skills call it rather than editing storage JSON.
- The editable Skill source is `resources/skills/markdown-comment/SKILL.md`. `esbuild.mjs` copies it into `dist/resources/` for VSIX plugin-install (rewrites `{{CLI}}` to an absolute path) and emits a portable copy at `dist/skill-hub/markdown-comment/` for Skill Hub / manual install.
- Preserve existing comment data. A migration from the former VS Code global storage must be safe and idempotent.

## Commands

Use Rush commands from the repository root:

```sh
rush build --to vscode-markdown-comment
rush typecheck --to vscode-markdown-comment
```

Browser preview / Zed: `markdown-comment preview <file.md>` starts an on-demand local server; `markdown-comment extension zed|vscode` prints install paths. The Zed extension must call the public CLI, not a private store format.

CLI npm tarball: `rushx pack-release` → `dist/markdown-comment-<ver>.tgz` (zero runtime deps; ships `zed/` + VSIX). Prefer `npm install -g ./markdown-comment-<ver>.tgz` over unpack-only install paths.

Do not run `pnpm` at the repository root. When the migration changes the build or test setup, update this file and the package README in the same change.
