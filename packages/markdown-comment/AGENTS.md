# Markdown Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and this package's target [architecture](docs/architecture/markdown-comment.md) before working here.

## Current state

The current implementation has been migrated from the former standalone VS Code package. It is functional but still partly VS Code-centred: `src/storage.ts` follows the existing VS Code global-storage pointer, and `src/extension.ts` / `src/preview/` are VS Code-only. Anchoring is already editor-neutral: `src/core/anchor.ts` works on plain text + offsets (covered by `tests/anchor.test.ts`), and `src/anchor.ts` is only the VS Code coordinate wrapper — change matching logic in the core, never in the wrapper. `src/adapters/obsidian/` is the Obsidian desktop plugin (a client of the same store, CLI, and Skill); see the README "Obsidian" section. Treat the architecture document as the destination, not a claim about the current source layout.

## Design constraints

- Start with the Markdown comment domain, never an editor API.
- Put models, anchor relocation, operations, and portable storage behind editor-neutral interfaces.
- Keep VS Code-specific code under an adapter boundary. `vscode` types must never leak into core modules.
- `src/core/**` must not import `vscode`, `obsidian`, or DOM globals. Obsidian code lives only in `src/adapters/obsidian/`, is type-checked by `tsconfig.obsidian.json` (DOM lib; excluded from `tsconfig.json`), and is bundled by `esbuild.mjs` into `dist/obsidian/` (excluded from the VSIX). Keep Obsidian logic that needs no host API in `model.ts` so it stays unit-testable.
- The Obsidian adapter must not change the stored schema, CLI behavior, or Skill; labels are a `[label] ` prefix in the first comment body.
- The CLI is a public automation interface; Skills call it rather than editing storage JSON.
- The editable Skill source is `resources/skills/markdown-comment/SKILL.md`. `esbuild.mjs` copies it into `dist/resources/` for VSIX plugin-install (rewrites `{{CLI}}` to an absolute path) and emits a portable copy at `dist/skill-hub/markdown-comment/` for Skill Hub / manual install.
- Preserve existing comment data. A migration from the former VS Code global storage must be safe and idempotent.

## Commands

Use Rush commands from the repository root:

```sh
rush build --to vscode-markdown-comment
rush typecheck --to vscode-markdown-comment   # tsconfig.json + tsconfig.webview.json + tsconfig.obsidian.json
```

Run tests from this package directory with `rushx test`. The Obsidian-API code (`reading.ts`, `sidebar-view.ts`, `main.ts`, …) cannot be exercised headlessly; verify it by hand in Obsidian.

Do not run `pnpm` at the repository root. When the migration changes the build or test setup, update this file and the package README in the same change.
