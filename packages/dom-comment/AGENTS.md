# DOM Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and [docs/design.md](docs/design.md) before working here.

## Project goal

Mark DOM elements, selected text, or drag-select regions on a live page in the user's Chrome, attach comments, and let an Agent read/reply via CLI + Skill.

Sibling of `markdown-comment`. Do not share storage or TypeScript types with it.

## Current state

Design **rev 7**. OpenSpec change `reshape-annotation-loop` is active. Build with `rushx build`; load `.output/chrome-mv3`.

## Decided product shape (rev 7)

- Chrome MV3 extension. Toolbar popup starts/stops annotation and copies the skill prompt. The page only shows pins and the composer while annotating.
- Comments save as soon as the user submits. No publish step.
- Pins show only while annotating. Esc hides them; data stays.
- Gestures: click element, select text, drag region (no Shift). Hold Space to peek at the page.
- Storage: package-local `packages/dom-comment/data/` (gitignored), one JSON file per tab id.
- Agent lookup: parse `tabid:` / `url:` first; otherwise `list --open`. Never dump every tab by default.

## Follow-ups

- **Install UX** still awkward: Chrome cannot auto-load an unpacked extension; Native Messaging still needs a manifest under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. `rushx setup` wraps host+skill but the user must still load `.output/chrome-mv3` by hand.
- Reproducing: cropped PNG first; `dom-comment open --tab` only focuses the original logged-in tab. No Playwright, no CDP.
- UI: vanilla Shadow overlay for hover, pins, banner, and the queue.

## OpenSpec

Active change: `openspec/changes/reshape-annotation-loop`. Implement the next unchecked `tasks.md` item; do not start a second change.

## Constraints

- Comment domain independent of any one Agent host SDK. Skill calls the public CLI only.
- User-facing copy: Chinese. Identifiers and commits: English.
- No collaboration server. No merging with markdown-comment.
- Do not rename the package, CLI, or storage root in this change.
