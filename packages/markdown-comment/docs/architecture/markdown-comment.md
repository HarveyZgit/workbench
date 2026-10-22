# Markdown Comment architecture

> Status: the existing VS Code implementation has been migrated into `packages/markdown-comment`. This is the target architecture for its next refactoring phase; the current implementation remains VS Code-centred until the core is extracted.

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

### Current comment rendering and attachments

The paragraphs above describe the storage target. The current implementation still uses the extension's global storage directory, discovered by the CLI through `~/.markdown-comment/pointer.json` or the explicit `MARKDOWN_COMMENT_STORAGE_DIR` override. This feature does not migrate that directory or change existing document keys.

Comment bodies remain raw Markdown strings in storage and on the host/webview protocol. The sidebar uses the preview Markdown renderer with a comment-specific context, shares the preview strict/safe HTML policy and sanitizes raw HTML in safe mode. Editing reads the original wire body rather than rendered DOM text. Comment rendering does not register document source anchors or outline entries. Code-copy controls live outside each code block's horizontal scroll container, in a dedicated toolbar that reserves space rather than overlaying code. A per-block wrap toggle changes presentation only and leaves code text and source anchors intact. Rendered text copy supports native copy events and a bounded extension-host clipboard message for Cmd/Ctrl+C; editable inputs retain native clipboard behavior. A webview-scoped context action receives only the current rendered selection through VS Code context metadata and writes the host clipboard; it does not override global editor copy commands. Enabled composer fields use the editor surface with a visible border and focus ring, while pending disabled fields use input/disabled theme tokens. The shared renderer attaches escaped language metadata to code elements; the toolbar displays that label as text, separately from the copy payload. Explicit fence languages take precedence. Unlabelled fenced and indented blocks use bounded, conservative highlight.js detection (minimum relevance 5 and a margin of 2 over the runner-up), falling back to txt for short, large, or ambiguous content.

`StoredComment` gains optional ordered attachment metadata, preserving compatibility with version-1 documents without attachments. New image drafts are pasted into the composer textarea and live in webview memory until submission; ordinary text paste stays native. Create, reply, and edit send either new image data or retained attachment IDs; retained IDs must belong to the comment being edited. The host validates count, sizes, raster type/signature, and paths before accepting a write. PNG, JPEG, GIF, and WebP are supported, with limits of 10 images per comment, 10 MiB per image, and 30 MiB total.

Attachment bytes live under `attachments/` in the same store, named using generated opaque IDs rather than supplied filenames. Ordered metadata belongs to the comment, while webview resource URLs are generated by the VS Code adapter and never persisted. This separates portable storage from editor-specific URLs and keeps images stable across document-key moves, including untitled-to-file saves. Only the attachment directory is added to the webview's resource roots; filenames and retained IDs are validated to prevent traversal or unrelated-file access.

The submission protocol acknowledges success or failure so the UI only discards a draft after a successful save. Canceling a draft writes nothing. Failed writes clean up newly created files without deleting existing attachments. Backup and transfer must include both document JSON and the attachment directory. Automatic garbage collection of previously persisted, unreferenced attachments is deferred to avoid racing concurrent adapters.

## Package shape during migration

Keep one package initially to avoid artificial release coupling, but enforce internal boundaries:

```text
packages/markdown-comment/
  src/core/          # data model, anchors, operations; no client SDKs
  src/storage/       # portable store and migrations
  src/cli/           # public command-line adapter
  src/adapters/vscode/
  src/adapters/web/  # optional local browser/agent adapter
  resources/skills/markdown-comment/
    SKILL.md         # package-managed Agent instructions using the public CLI
    scripts/         # portable CLI locator for Skill Hub / self-install
```

Split these into published packages only when separate release cadence or reuse makes that worthwhile. Do not duplicate the core inside an extension, server, or Skill.

## Migration sequence

1. ✅ Move the existing extension, CLI, build configuration, and Skill into this package without dropping the existing user workflow.
2. Extract editor-neutral types, anchors, operations, and storage from the VS Code extension into the core.
3. Make the CLI use the portable store directly; retain a one-time, safe import path for existing VS Code data.
4. Convert the VS Code extension into an adapter over the core, preserving the rendered-preview experience.
5. Add a local web/agent adapter only after the core and storage boundaries are exercised by CLI and VS Code.

Each step must leave a working tool. Avoid a flag-day rewrite or a storage-format break.

## Non-goals for the first migration

- Multi-user collaboration, hosted synchronization, and a database service.
- Coupling the core to an individual Agent vendor or IDE.
- A large package split before the core boundary has proved useful.

The bundled Agent Skill defaults to replying without changing thread status. Resolving requires an explicit user request; CLI reply itself does not resolve a thread.
