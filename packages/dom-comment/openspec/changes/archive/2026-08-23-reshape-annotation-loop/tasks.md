## 1. Docs

- [x] 1.1 Archive `add-tab-comments` and add this change (proposal / specs / design / tasks)
- [x] 1.2 Update `docs/design.md` rev 7, package `AGENTS.md`, README, OpenSpec config

## 2. Core, storage, CLI

- [x] 2.1 Add pending/published, `batchId`, `number`, and text capture/anchor types
- [x] 2.2 Add `publishPending` / `deleteThread` / `discardPending`; create is pending
- [x] 2.3 Add `listBatches`; CLI `list` without `--tab` lists published batches
- [x] 2.4 Agent Markdown helper for copy fallback
- [x] 2.5 Tests: pending hidden from CLI, publish then `list --open`, delete pending, text anchor

## 3. Native host

- [x] 3.1 Add `publishTab` / `deleteThread` / `discardPending`
- [x] 3.2 Protocol tests for publish and reject empty pending

## 4. Extension

- [x] 4.1 Numbered pins stay visible after exiting annotation mode
- [x] 4.2 Gestures: click element, select text, drag region; Space peeks
- [x] 4.3 In-page floating queue: list, delete, discard, publish, copy Markdown
- [x] 4.4 Popup: start/stop, pending count, show queue; tabid copy is fallback

## 5. Skill

- [x] 5.1 Default flow `list --open`; keep `tabid:` / `url:` as fallback
