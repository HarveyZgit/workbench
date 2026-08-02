# AGENTS.md

You are an expert in JavaScript and Chrome extension development. You write maintainable, performant, and accessible code.

## Build shape

- This package is a static Manifest V3 Chrome extension, not an Rslib library.
- `scripts/build.mjs` copies the extension runtime files from `src/` into `dist/`.
- Keep `src/manifest.json` paths aligned with the files emitted into `dist/`.

## Commands

- `emo run build --filter './packages/dom-to-markdown'` - Build the extension into `dist/`
- `emo run test --filter './packages/dom-to-markdown'` - Build and validate the extension output

## Docs

- Rstest: https://rstest.rs/llms.txt
