# Markdown Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and this package's target [architecture](docs/architecture/markdown-comment.md) before working here.

## Current state

The current implementation has been migrated from the former standalone VS Code package. It is functional but still VS Code-centred: `src/anchor.ts` uses VS Code ranges and `src/storage.ts` follows the existing VS Code global-storage pointer. Treat the architecture document as the destination, not a claim about the current source layout.

## Design constraints

- Start with the Markdown comment domain, never an editor API.
- Put models, anchor relocation, operations, and portable storage behind editor-neutral interfaces.
- Keep VS Code-specific code under an adapter boundary. `vscode` types must never leak into core modules.
- The CLI is a public automation interface; Skills call it rather than editing storage JSON.
- The editable Skill source is `resources/skills/markdown-comment/SKILL.md` at the repository root. `esbuild.mjs` copies it into `dist/resources/` for distribution.
- Preserve existing comment data. A migration from the former VS Code global storage must be safe and idempotent.

## Commands

Use Rush commands from the repository root:

```sh
rush build --to vscode-markdown-comment
rush typecheck --to vscode-markdown-comment
```

Do not run `pnpm` at the repository root. When the migration changes the build or test setup, update this file and the package README in the same change.
