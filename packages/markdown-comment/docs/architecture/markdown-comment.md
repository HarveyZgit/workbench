# Markdown Comment architecture

> Status: the existing VS Code implementation has been migrated into `packages/markdown-comment`. Anchor logic is already extracted into `src/core/anchor.ts` and shared by the VS Code and Obsidian adapters; the domain model, operations, and storage are still being moved behind the core boundary, so the rest of the source layout remains VS Code-centred. Treat the layout below as the destination.

## Product definition

Markdown Comment lets people attach discussion threads to an entire Markdown document or to a selected piece of its content. Threads survive ordinary edits through anchor relocation. A person, a CLI, or an AI Agent can then read, reply to, and resolve the same threads.

The product is not a VS Code feature with an auxiliary CLI. It is a Markdown-commenting capability with multiple clients.

## Layering

```text
Markdown files + comment store
             │
             ▼
     domain core and storage contract
             │
     ┌───────┼──────────┬──────────────┐
     ▼       ▼          ▼              ▼
    CLI   VS Code    local web       future clients
                    / agent view
     │       │          │              │
     └───────┴──────────┴──────────────┘
                 same threads
```

### Core

The core is editor-neutral TypeScript. It owns:

- document identity and text loading contracts;
- `Thread`, `Comment`, status, author, timestamp, and attachments when supported;
- text anchors and relocation;
- storage reads, atomic writes, and schema migration;
- operations such as create, reply, edit, resolve, reopen, and delete.

Core APIs use plain text, canonical file paths/URIs, offsets, and serializable data. They must not depend on VS Code `TextDocument`/`Range`, Webview APIs, DOM APIs, or terminal globals.

An anchor records a preferred text range plus quote and surrounding context. Relocation is a pure core operation: clients render the result but do not implement their own matching rules.

### Adapters

Adapters translate a client interaction into a core operation and display the returned thread state.

| Adapter | Responsibility | Must not own |
| --- | --- | --- |
| CLI | Stable automation interface for people and Agents | its own data format or anchor algorithm |
| VS Code extension | editor commands, rendered preview, source navigation, UI state | the only writable comment store |
| Obsidian plugin | reading/editing-view selection and block capture, sidebar, highlights, store watching | its own anchor algorithm, a second data format, a fork of the thread model |
| Skill | tells an Agent how to use the public CLI/API | direct JSON mutation |
| Local web / agent view | browser UI and local transport | a forked thread model |
| Future IDE adapter | IDE-specific selection and navigation conversion | core business rules |

The VS Code rendered preview remains adapter code. Markdown parsing, Mermaid,
KaTeX, resource URI translation, and editor scroll synchronization may depend on
Webview and VS Code APIs, but comments created from those rendered elements must
still resolve to portable source anchors. A rendered Mermaid diagram therefore
uses the opening fence line as its source anchor and optional display metadata;
the stored thread never depends on generated SVG ids, layout coordinates, or a
Mermaid runtime object.

## Storage and compatibility

The default storage location belongs to Markdown Comment itself, not to a host editor. It must be usable by the CLI before any editor extension has been launched, with `MARKDOWN_COMMENT_STORAGE_DIR` available as an explicit override.

The existing VS Code global-storage JSON format is an import/compatibility source during migration. Migration must be explicit, idempotent, and non-destructive; users must not lose existing comment threads when they upgrade.

For each write, read the latest document state, apply the smallest operation, then atomically replace the JSON file. This avoids partial files and reduces stale whole-document overwrites between adapters.

## Package shape during migration

Keep one package initially to avoid artificial release coupling, but enforce internal boundaries:

```text
packages/markdown-comment/
  src/core/          # data model, anchors, operations; no client SDKs
  src/storage/       # portable store and migrations
  src/cli/           # public command-line adapter
  src/adapters/vscode/
  src/adapters/obsidian/  # Obsidian desktop plugin (built to dist/obsidian/)
  src/adapters/web/  # optional local browser/agent adapter
  resources/skills/markdown-comment/
    SKILL.md         # package-managed Agent instructions using the public CLI
    scripts/         # portable CLI locator for Skill Hub / self-install
```

Split these into published packages only when separate release cadence or reuse makes that worthwhile. Do not duplicate the core inside an extension, server, or Skill.

## Migration sequence

1. ✅ Move the existing extension, CLI, build configuration, and Skill into this package without dropping the existing user workflow.
2. Extract editor-neutral types, anchors, operations, and storage from the VS Code extension into the core. *(Anchors done: `src/core/anchor.ts` takes plain text + offsets, and `src/anchor.ts` is a thin VS Code wrapper. Operations and storage remain.)*
3. Make the CLI use the portable store directly; retain a one-time, safe import path for existing VS Code data.
4. Convert the VS Code extension into an adapter over the core, preserving the rendered-preview experience.
5. First additional adapter: Obsidian (`src/adapters/obsidian/`), built on the core anchors and the shared store without changing the schema, CLI, or Skill. Its Obsidian-API code is verified by hand in Obsidian; only its pure helpers have automated tests.
6. Add a local web/agent adapter only after the core and storage boundaries are exercised by CLI and VS Code.

Each step must leave a working tool. Avoid a flag-day rewrite or a storage-format break.

## Non-goals for the first migration

- Multi-user collaboration, hosted synchronization, and a database service.
- Coupling the core to an individual Agent vendor or IDE.
- A large package split before the core boundary has proved useful.
