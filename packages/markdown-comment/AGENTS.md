# Markdown Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and the target [architecture](../../docs/architecture/markdown-comment.md) before working here.

## Current state

This directory is a landing scaffold for a migration. The present Rslib/Rstest sample (`src/index.ts`) does **not** describe the future product and should not shape new APIs. Keep it working until it is deliberately replaced as part of the migration.

## Design constraints

- Start with the Markdown comment domain, never an editor API.
- Put models, anchor relocation, operations, and portable storage behind editor-neutral interfaces.
- Keep VS Code-specific code under an adapter boundary. `vscode` types must never leak into core modules.
- The CLI is a public automation interface; Skills call it rather than editing storage JSON.
- Preserve existing comment data. A migration from the former VS Code global storage must be safe and idempotent.

## Commands

Use Eden Monorepo commands from the repository root:

```sh
emo build --filter './packages/markdown-comment'
emo test --filter './packages/markdown-comment'
```

Do not run `pnpm` directly in this repository. When the migration changes the build or test setup, update this file and the package README in the same change.
