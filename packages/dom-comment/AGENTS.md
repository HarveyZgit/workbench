# DOM Comment package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and [docs/design.md](docs/design.md) before working here.

## Project goal

Mark DOM elements, selected text, or drag-select regions on a live page in the user's Chrome, attach comments, and let an Agent read/reply via CLI + Skill.

Sibling of `markdown-comment`. Do not share storage or types with it.

## Current state

Design **rev 7**. OpenSpec change `npm-cli-package` is active. Build with `rushx build`; the packed extension is `dist/chrome-mv3`.

## Decided product shape (rev 7)

- CLI `dom-comment`: GitHub Release zip + `install.sh`; `install` (host + Skill to user-chosen dirs), `extension` (print packed dir), and runtime `list` / `reply` / `resolve` / `open`.
- Chrome MV3 extension. Toolbar popup starts/stops annotation and copies the skill prompt. The page only shows pins and the composer while annotating.
- Comments save as soon as the user submits. No publish step.
- Pins show only while annotating. Esc hides them; data stays.
- Gestures: click element, select text, drag region (no Shift). Hold Space to peek at the page.
- Storage: source tree uses `packages/dom-comment/data/`; zip installs use the user data directory. Override with `DOM_COMMENT_STORAGE_DIR`.
- Agent lookup: parse `tabid:` / `url:` first; otherwise `list --open`. Never dump every tab by default.

## Follow-ups

- Chrome still cannot auto-load an unpacked extension; `install` / `extension` only print the path.
- Agent reads comments and cropped PNGs only. Do not run `open --tab` unless the user asks to focus the original tab. No Playwright, no CDP, no headless browse.

## OpenSpec

Active change: `openspec/changes/npm-cli-package`. Implement the next unchecked `tasks.md` item; do not start a second change.

## Constraints

- Comment domain independent of any one Agent host SDK. Skill calls the public CLI only.
- User-facing copy: Chinese. Identifiers and commits: English.
- No collaboration server. No merging with markdown-comment.
- CLI / Skill 名是 `dom-comment`。分发走 GitHub Release zip，不上 npmjs。
