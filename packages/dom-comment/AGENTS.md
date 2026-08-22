# DOM Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and [docs/design.md](docs/design.md) before working here.

## Project goal

Mark DOM elements or drag-select regions on a live page in the user's Chrome, attach comments, and let an Agent read/reply via CLI + Skill.

Sibling of `markdown-comment`. Do not share storage or TypeScript types with it.

## Current state

Design **rev 6**. OpenSpec change `add-tab-comments` tasks are implemented: core, native host, MV3 extension (esbuild, not WXT), Skill. Build with `rushx build`; load `.output/chrome-mv3`.

## Decided product shape (rev 6)

- Chrome MV3 extension. Toolbar opens a **popup** (icon starts annotation; two copyable `/dom-comment tabid:…` prompts). Esc stops annotation; on-page hint required.
- Storage: package-local `packages/dom-comment/data/` (gitignored), one JSON file per tab id. Not `~/.dom-comment`, not Chrome `Local Extension Settings` (LevelDB, CLI 读不了).
- Pins only visible in annotation mode; click a pin to view/edit; area rubber-band stays while the composer is open.

## Follow-ups

- **Install UX** still awkward: Chrome cannot auto-load an unpacked extension; Native Messaging still needs a manifest under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (Chrome API, not our comment store). `rushx setup` wraps host+skill but the user must still load `.output/chrome-mv3` by hand. Revisit later (do not expand into a daemon or store listing unless asked).
- On save: cropped PNG of the element/area plus text snapshot.
- Agent lookup: parse `tabid:` / `url:` first, then natural language. Never dump every tab by default.
- Reproducing: cropped PNG first; `dom-comment open --tab` only focuses the original logged-in tab. No Playwright, no CDP. If the tab is gone, stay on the screenshot.
- UI: shadcn in popup / composer / side panel; vanilla overlay for hover and the in-mode banner.

## OpenSpec

Active change: `openspec/changes/add-tab-comments`. Implement the next unchecked `tasks.md` item; do not start a second change.

## Constraints

- Comment domain independent of any one Agent host SDK. Skill calls the public CLI only.
- User-facing copy: Chinese. Identifiers and commits: English.
- No collaboration server. No merging with markdown-comment.
