## 1. Core, storage, CLI（PR 1）

- [x] 1.1 Add `src/core/types.ts` (`StoredTabFile` / page / thread / element+area anchors / comments)
- [x] 1.2 Add `canonicalizeUrl` and `urlHash` in `src/core/identity.ts`
- [x] 1.3 Add `foldWhitespace`, `buildAnchor`, relocate `scoreCandidate` / `pickCandidate` (threshold 1000)
- [x] 1.4 Add in-place `ops.createThread` / `reply` / `resolve` / `updateRelocate` (reject empty body)
- [x] 1.5 Add storage: pointer, `.session`, `loadTab`/`saveTab`, session archive rotation, PNG path helper, atomic write
- [x] 1.6 Add CLI `list --tab/--url/--open/--hidden/--json`, `reply`, `resolve`; `open --tab` fails with 截图 message when socket missing
- [x] 1.7 Add `node:test` coverage: canonicalize, scoring table, first create, reply keeps screenshot/relocateStatus/other pages, session rotation, empty body
- [x] 1.8 Add esbuild CLI bundle, package scripts, register `dom-comment` in `rush.json`, `rush update` + `rush test --to dom-comment` + `rush typecheck --to dom-comment`

## 2. Native host（PR 2）

- [x] 2.1 Implement native-host stdio protocol (`ping` / `loadTab` / `createThread` with PNG / `reply` / `resolve` / `updateRelocate` / `focusTab`)
- [x] 2.2 Implement `install-host` / `uninstall-host` / `ping-host` (snapshot `process.execPath`, mkdir NativeMessagingHosts, freeze `chrome-extension.json`)
- [x] 2.3 Bind `~/.dom-comment/host.sock` (0600) while NM is connected; unlink on disconnect

## 3. Extension overlay（PR 3a）

- [x] 3.1 WXT skeleton, `manifest.key`, popup with start/stop icon and two copyable prompts
- [x] 3.2 Global annotation mode, plus/X icons, Esc, on-page banner, vanilla hover outline and 8px rubber-band (no persist)

## 4. Composer and screenshot（PR 3b）

- [x] 4.1 Shadow DOM shadcn composer for element and area
- [x] 4.2 Crop `captureVisibleTab` and persist via host `createThread`; host-missing Chinese error

## 5. Side panel（PR 4）

- [x] 5.1 Side panel lists current tab+URL; option for all pages in that tab; read-only; WXT `/sidepanel.html`

## 6. Skill（PR 5）

- [x] 6.1 Package Skill + `install-skill`; `{{CLI}}` locator script; extend `SCAN_PREFIXES`; parameter-first lookup; forbid Playwright/CDP/fetch

## 7. Polish（PR 6）

- [x] 7.1 In-page pins / area rect replay, side-panel resolve, README / AGENTS 收口
