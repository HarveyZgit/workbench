# Markdown Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and this package's target [architecture](docs/architecture/markdown-comment.md) before working here.

## Current state

The current implementation has been migrated from the former standalone VS Code package. It is functional but still VS Code-centred: `src/anchor.ts` uses VS Code ranges and `src/storage.ts` follows the existing VS Code global-storage pointer. Treat the architecture document as the destination, not a claim about the current source layout.

## Design constraints

- Start with the Markdown comment domain, never an editor API.
- Put models, anchor relocation, operations, and portable storage behind editor-neutral interfaces.
- Keep VS Code-specific code under an adapter boundary. `vscode` types must never leak into core modules.
- The CLI is a public automation interface; Skills call it rather than editing storage JSON.
- The editable Skill source is `resources/skills/markdown-comment/SKILL.md`. `esbuild.mjs` copies it into `dist/resources/` for VSIX plugin-install (rewrites `{{CLI}}` to an absolute path) and emits a portable copy at `dist/skill-hub/markdown-comment/` for Skill Hub / manual install.
- Preserve existing comment data. A migration from the former VS Code global storage must be safe and idempotent.

## Commands

Use Eden Monorepo commands from the repository root:

```sh
emo run build --filter './packages/markdown-comment'
emo run check --filter './packages/markdown-comment'
```

Do not run `pnpm` directly in this repository. When the migration changes the build or test setup, update this file and the package README in the same change.
