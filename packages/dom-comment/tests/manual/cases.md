# DOM Comment 手工测试用例

单元测试仍是 `tests/*.test.ts`。录屏和解压扩展副本不进仓库。

夹具：`fixtures/annotate.html`。构建后加载 `dist/chrome-mv3`。

```sh
cd packages/dom-comment
rushx build
node dist/cli.js install-skill
python3 -m http.server 8765 --directory fixtures
```

## 15 分钟冒烟

日常复跑只走这些：TC-01 加载、TC-03 工具栏左键进模式（自动开抽屉）、刷新退出、划选文字、拖区域、标注中点链接、保存、Esc（先关抽屉再退出）、右键复制 prompt、悬浮球抽屉 / 退出后序号+选中高亮、CLI `list`、file:// 冒烟（先勾 Allow access to file URLs）。完整用例不要每次全跑。

---

Package: `packages/dom-comment` (HarveyZgit/workbench)  
Unpacked Load path: `dist/chrome-mv3`  
Official build output (same files): `dist/chrome-mv3`  
Fixture page (http/https or file:// after the Chrome toggle): `fixtures/annotate.html`  
CLI: `node dist/cli.js`

Chrome: open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose `dist/chrome-mv3`.  
No extra Chrome launch flags are required. Content scripts run on `http://*/*`, `https://*/*`, and `file:///*`. `chrome://` and `chrome-extension://` stay unsupported. Chrome cannot enable file-URL access from code: after Load unpacked, open this extension on `chrome://extensions` and tick **Allow access to file URLs**.

Serve the fixture before UI cases:

```sh
python3 -m http.server 8765 --directory fixtures
```

Then open `http://127.0.0.1:8765/annotate.html`.

Native Messaging host name: `com.workbench.dom_comment`.  
Official `dom-comment install-skill` / `install-host` only writes macOS Chrome/Canary/Chromium NativeMessagingHosts under `~/Library/Application Support/…`. On Linux it exits 1 (`未找到 Chrome/Chromium 配置目录`). Persist/CLI-after-save cases need a macOS Chrome profile + `rushx setup` (or `node dist/cli.js install-skill`). No account/password is required.

Status key: **READY** = can run with the unpacked dir + an http(s) page. **HOST** = needs Native Messaging registered (macOS Chrome). **No credential BLOCKED cases.**

---

## TC-01 — Load unpacked extension

- **id:** TC-01
- **title:** Load unpacked MV3 extension in Chrome
- **status:** READY
- **precondition:** Chrome is installed. Developer mode is off or on. Directory `dist/chrome-mv3` exists and contains `manifest.json`.
- **steps:**
  1. Open `chrome://extensions`.
  2. Turn on **Developer mode** (top-right).
  3. Click **Load unpacked**.
  4. Select `dist/chrome-mv3`.
- **expected:**
  - Card appears named **DOM Comment**, version **0.0.2**.
  - No errors in the card (no service worker crash).
  - Toolbar plus icon is present; tooltip is **进入标注模式**.
  - Extension id is `dhipgcobhfgnlklihnjkbihfomcnolbi` (pinned by `key` in manifest).
  - Errors page does not show a missing-file / invalid-manifest failure.

---

## TC-02 — Reload after source rebuild

- **id:** TC-02
- **title:** Reload unpacked after replacing files
- **status:** READY
- **precondition:** TC-01 passed. Tester can overwrite `dist/chrome-mv3` with a new `dist/chrome-mv3` build.
- **steps:**
  1. On `chrome://extensions`, click the reload arrow on DOM Comment.
  2. Confirm the service worker is still running.
- **expected:** Extension stays enabled, toolbar left-click still enters mode, no new error badge.

---

## TC-03 — Toolbar left-click enters annotate mode

- **id:** TC-03
- **title:** Left-click toolbar icon enters annotate mode (no popup)
- **status:** READY
- **precondition:** Extension loaded. Fixture `http://127.0.0.1:8765/annotate.html` is the active tab.
- **steps:**
  1. Left-click the toolbar icon once.
  2. Look at the fixture page and the toolbar icon.
- **expected:**
  - No popup appears.
  - Page shows a top-center pill: **标注中 · Esc 退出 · 长按空格看原页面**.
  - Toolbar icon switches to the X icon; tooltip becomes **退出标注模式**.
  - Right-side comment drawer opens automatically.
  - Drawer cards cannot select/highlight existing comments while annotating (resolve may still work); pin clicks do not open/select existing threads.
  - Bottom-right float ball **评** is visible (also when mode is off).

---

## TC-04 — Toolbar click toggles off / Esc exits

- **id:** TC-04
- **title:** Second toolbar click or Esc exits annotate mode
- **status:** READY
- **precondition:** TC-03. Annotate mode is on. Prefer drawer already open from enter; if closed, float-ball open is fine before exit.
- **steps:**
  1. Left-click the toolbar icon again (or press Esc with the drawer already closed).
- **expected:**
  - Annotate banner / hover / rubber / composer are gone.
  - Comment drawer opens automatically on exit.
  - Numbered pins (序号) remain visible on the page for review.
  - Drawer card select is enabled again; selecting a card scrolls and persistently highlights the anchored region (not only a brief flash). Pin click does the same.
  - Float ball remains.
  - Toolbar icon is plus again; tooltip **进入标注模式**.

---

## TC-05 — Refresh exits annotate mode

- **id:** TC-05
- **title:** Full page refresh exits mode and does not restore it
- **status:** READY
- **precondition:** Annotate mode on, fixture page.
- **steps:**
  1. Reload the tab (F5 / toolbar reload).
  2. Wait until the page is idle.
- **expected:**
  - After reload there is no annotate banner / hover / rubber (mode starts off).
  - If the tab already has saved threads, numbered pins may reappear in browse overlay after load; float ball is present; drawer can open.
  - Toolbar icon is plus (for this tab).
  - Mode does not come back until the user left-clicks the toolbar (or uses the shortcut) again.

---

## TC-06 — Keyboard toggle (Ctrl/Cmd+Period)

- **id:** TC-06
- **title:** Command/Ctrl+. toggles annotate mode without a popup
- **status:** READY
- **precondition:** Extension loaded. Fixture tab focused. Check `chrome://extensions/shortcuts` if the suggested key was remapped.
- **steps:**
  1. Press `Ctrl+.` (Linux/Windows) or `Cmd+.` (macOS).
  2. Press the same shortcut again.
- **expected:** First press enters annotate mode (banner + X icon). Second press exits. No popup.

---

## TC-07 — Hover outline on deepest element

- **id:** TC-07
- **title:** Hover draws a teal outline on the deepest reasonable element
- **status:** READY
- **precondition:** Annotate mode on, fixture page, no composer open.
- **steps:**
  1. Move the mouse over **保存更改**.
  2. Move over the aside **侧栏** block.
  3. Move over empty page chrome / `html`/`body`.
- **expected:**
  - Button and aside get a 2px solid `#1A6B54` outline.
  - `html`/`body` are not outlined (`skipTarget`).
  - Outline follows the cursor without blocking page layout.

---

## TC-08 — Click element opens composer (does not activate the control)

- **id:** TC-08
- **title:** Click element opens 评论 composer and does not click the page
- **status:** READY
- **precondition:** Annotate mode on, fixture page.
- **steps:**
  1. Click **保存更改**.
  2. Click the in-page link **这是一个链接，标注模式下不该跳走。**
- **expected:**
  - Composer card appears near the target (shadow host `dom-comment-ui`).
  - Label **评论**, placeholder **请输入评论内容**, **保存** button disabled while empty.
  - The button is not “pressed” as a real click; the hash link does not navigate.
  - Annotate mode stays on.

---

## TC-09 — Empty comment is rejected

- **id:** TC-09
- **title:** Save stays disabled / empty body shows 请输入评论内容
- **status:** READY
- **precondition:** Composer open from TC-08.
- **steps:**
  1. Leave the textarea empty; observe **保存**.
  2. Type spaces only; press Enter or click **保存**.
- **expected:** **保存** stays disabled for empty/whitespace. If submit is forced, error text **请输入评论内容** appears. No native-host call needed; no pin is created.

---

## TC-10 — Esc dismisses composer, second Esc exits mode

- **id:** TC-10
- **title:** Esc is two-stage (composer then mode)
- **status:** READY
- **precondition:** Annotate mode on, composer open, fixture page.
- **steps:**
  1. Press Esc.
  2. Press Esc again.
- **expected:**
  - First Esc closes the composer and draft pin; banner remains.
  - Second Esc exits annotate mode globally (banner gone, plus icon).

---

## TC-11 — Cancel rubber-band with Esc

- **id:** TC-11
- **title:** Esc while dragging cancels the region, keeps mode
- **status:** READY
- **precondition:** Annotate mode on, no composer.
- **steps:**
  1. Mouse-down on the page and drag more than 8px so a dashed rectangle appears.
  2. Press Esc before mouse-up.
- **expected:** Rubber-band disappears. Mode stays on. No composer.

---

## TC-12 — Drag region (≥8px) opens area composer

- **id:** TC-12
- **title:** Drag-select a region to comment
- **status:** READY
- **precondition:** Annotate mode on, fixture page.
- **steps:**
  1. Drag a box over the aside (width and height ≥ 8px). Release.
- **expected:**
  - During drag: dashed teal rectangle + light fill.
  - On release: composer opens at the box; a draft pin may show.
  - A tiny drag (< 8px) does **not** become a region (falls through to click/text).

---

## TC-13 — Select text to comment

- **id:** TC-13
- **title:** Text selection opens a 文字 thread composer
- **status:** READY
- **precondition:** Annotate mode on, fixture page.
- **steps:**
  1. Drag-select the sentence “保存更改后应当出现成功状态…” without exceeding a large 8px rubber-band if possible (or select then release without a region ≥ 8×8).
  2. Confirm composer opens with the selection as the target.
- **expected:** Composer opens for a text target. Selection is not stolen by a region if the drag stayed small. Mode stays on.

---

## TC-14 — Space peek hides overlay

- **id:** TC-14
- **title:** Hold Space to see the raw page
- **status:** READY
- **precondition:** Annotate mode on, banner visible, no composer, focus not in an input.
- **steps:**
  1. Hold Space.
  2. Release Space.
- **expected:** While held, banner/outlines/pins hide (`visibility: hidden`). On release they return. Space in a page `<input>` does not trigger peek.

---

## TC-15 — Alt walks up the hover ancestor chain

- **id:** TC-15
- **title:** Alt/Option expands hover to parent
- **status:** READY
- **precondition:** Annotate mode on, mouse over **保存更改**.
- **steps:**
  1. Press Alt (Option on macOS) once or twice without moving the mouse far.
- **expected:** Outline grows from the button to its parent section / main. Click then comments the currently outlined ancestor, not the original deepest node.

---

## TC-16 — Copy skill prompt from context menus

- **id:** TC-16
- **title:** 复制 skill prompt via action + page context menus
- **status:** READY
- **precondition:** Active tab is `http://127.0.0.1:8765/annotate.html`.
- **steps:**
  1. Right-click the toolbar extension icon → **复制 skill prompt**.
  2. Paste into a text field.
  3. Right-click the page (or a selection) → **复制 skill prompt** again.
- **expected:**
  - Brief in-page toast **已复制 skill prompt** (when content script runs).
  - Clipboard is one line: `/dom-comment tabid:<positive Chrome tab id> url:http://127.0.0.1:8765/annotate.html`.
  - On `chrome://` pages the page menu is absent / no-op; action menu may still offer the item but cannot inject (tabid-only when a page later copies).

---

## TC-16b — Float ball opens comment drawer

- **id:** TC-16b
- **title:** Float ball opens right drawer; card scrolls to pin; Esc closes drawer first
- **status:** READY
- **precondition:** Fixture page with at least one saved open thread (HOST) or empty list is fine for open/close smoke.
- **steps:**
  1. Click the bottom-right **评** float ball.
  2. Observe the right-side drawer.
  3. If a thread card exists, click it.
  4. Press Esc.
- **expected:**
  - Drawer slides in from the right listing current-page threads (optional “本标签页全部页面”); cards show 序号 badges when numbered.
  - While annotate mode is on, card click does not select/highlight existing comments.
  - While browse (mode off), card click scrolls toward the pin/anchor and keeps a persistent region highlight; orphaned shows a drawer hint. Closing the drawer clears the highlight.
  - Esc closes the drawer without exiting annotate mode. A second Esc (with drawer closed) exits mode (and re-opens the drawer for browse).

---

## TC-17 — chrome:// is not annotatable

- **id:** TC-17
- **title:** chrome:// pages get no content script
- **status:** READY
- **precondition:** Extension loaded.
- **steps:**
  1. Open `chrome://extensions`, enter annotate mode via shortcut.
- **expected:**
  - No banner / overlay on `chrome://`.
  - Toolbar left-click may flip the icon, but no overlay on chrome://.
  - `chrome://` stays unsupported.

---

## TC-17b — file:// is annotatable after Allow access to file URLs

- **id:** TC-17b
- **title:** file:// pages can be annotated when the Chrome toggle is on
- **status:** READY
- **precondition:** Extension loaded. On `chrome://extensions` for this extension, tick **Allow access to file URLs**.
- **steps:**
  1. Open `fixtures/annotate.html` as a `file://` URL (or any local HTML file).
  2. Enter annotate mode via shortcut or toolbar left-click.
  3. Click an element or drag a region (smoke; no need to persist).
- **expected:**
  - Banner / overlay appears on the file page.
  - Click / select / drag works like on http.
  - Popup copy-prompt includes `url:file://…`.
  - Without the toggle, no overlay (same as chrome://). Chrome cannot turn the toggle on from code.

---

## TC-18 — Save without native host shows Chinese error

- **id:** TC-18
- **title:** Persist fails with 本机写入未就绪 when host is not registered
- **status:** READY (expected failure on this Linux box)
- **precondition:** Extension loaded. `dom-comment install-host` has **not** succeeded (Linux official install fails). Annotate mode on, fixture over HTTP.
- **steps:**
  1. Click **保存更改**, type `按钮没有成功反馈`, click **保存** or press Enter.
- **expected:**
  - Composer stays open.
  - Error: **本机写入未就绪。在 packages/dom-comment 运行 rushx setup，再刷新这个扩展。** (or the 8s timeout with the same text).
  - No `{tabId}.json` under `packages/dom-comment/data/`.
  - `node dist/cli.js list --open` still prints `（没有网页标记。）`.

---

## TC-19 — Save element comment + cropped screenshot

- **id:** TC-19
- **title:** Submitting a comment writes JSON + PNG immediately
- **status:** HOST (macOS Chrome + `node dist/cli.js install-skill` / `rushx setup`, then reload the extension)
- **precondition:** Native host registered; `node dist/cli.js ping-host` prints `pong`; Chrome was restarted or the extension reloaded after install. Fixture tab active. `DOM_COMMENT_STORAGE_DIR` unset so source-tree data goes to `packages/dom-comment/data/`.
- **steps:**
  1. 开始标记 → click **保存更改** → type `文案太长，折行了` → 保存.
  2. Note the Chrome tab id from the copied prompt.
  3. Run `node dist/cli.js list --tab <id>`.
- **expected:**
  - Composer switches to the thread panel (author **我**, body visible, resolve/close icons).
  - Numbered pin appears on the button.
  - CLI lists `[元素] button … [截图]` with the comment.
  - A PNG exists under `packages/dom-comment/data/<tabId>/<urlHash>/<threadId>.png`.
  - No extra “publish” step.

---

## TC-20 — Save region and text comments

- **id:** TC-20
- **title:** Area and text threads persist as [区域] / [文字]
- **status:** HOST
- **precondition:** Same as TC-19. Annotate mode still on.
- **steps:**
  1. Drag a region over the aside; save `这整块信息层级乱`.
  2. Select “邮箱通知文案要和页面其余部分一致。”; save `语气不一致`.
  3. `list --tab <id>`.
- **expected:** Three threads: element, area, text. Area pin is a filled rectangle + number. Text pin is a number. CLI kinds `[元素]` / `[区域]` / `[文字]`, each `[截图]` if capture succeeded. Capture failure still saves the text (`screenshot: ''`, CLI `[无截图]`).

---

## TC-21 — Thread panel mutations via create / focus; pin select is browse-only

- **id:** TC-21
- **title:** In-page thread panel mutations
- **status:** HOST
- **precondition:** At least one saved open thread.
- **steps:**
  1. While annotate mode is on, click a numbered pin — it must not open/select that existing thread.
  2. Exit annotate mode (browse). Click the numbered pin (or drawer card) to select + highlight.
  3. Re-enter annotate and create a new annotation (or use SET_FOCUS_THREAD / agent focus) to open a thread panel, then: reply `补充：再看截图` → 保存; edit a comment; delete a comment; resolve.
- **expected:** Annotate pin-click does not select existing comments. Browse pin/card select scrolls + persistent highlight. Panel mutations refresh; reply shows as **我**; resolve marks resolved; CLI `list --open` hides it; `list --tab <id>` still shows `[已解决]`. Numbered pins remain after exiting annotate.

---

## TC-22 — Esc after save keeps numbered pins for browse; data remains

- **id:** TC-22
- **title:** Leaving annotate mode keeps review pins; disk data remains
- **status:** HOST
- **precondition:** TC-19/20 saved threads exist.
- **steps:**
  1. Press Esc until annotate mode is off (drawer may close first, then mode).
  2. Confirm annotate banner/hover are gone, but numbered pins remain and the drawer opens on exit.
  3. `list --tab <id>` again.
  4. Enter annotate again on the same URL.
- **expected:** Disk data unchanged. Browse shows 序号 pins; re-entering annotate relocates pins and disables selecting existing comments.

---

## TC-23 — Side panel list and resolve

- **id:** TC-23
- **title:** Side panel shows current-tab threads
- **status:** HOST (panel UI itself is READY; rows need host data)
- **precondition:** Extension loaded. Chrome side panel available.
- **steps:**
  1. Prefer the in-page float ball / drawer. Optional: bind `open-side-panel` in `chrome://extensions/shortcuts` (opens the in-page drawer on the active tab).
  2. With the fixture tab active, look at the list.
  3. Toggle **此标签页全部页面**.
  4. If a thread is open, click **标记已解决**.
- **expected:**
  - Header **DOM Comment**.
  - Empty state **没有评论** when host/data missing.
  - With data: items like `[元素] 保存更改  #<8-char-id>`.
  - Checkbox includes other URLs visited in this tab.
  - Resolve button only on open threads; list refreshes.

---

## TC-24 — Same element clicked twice creates a new thread

- **id:** TC-24
- **title:** Re-clicking the same node starts a new thread
- **status:** HOST
- **precondition:** One saved thread on **保存更改**.
- **steps:**
  1. In annotate mode, click **保存更改** again and save `第二条`.
- **expected:** Two pins / two CLI rows for the same button. No in-place edit of the first thread.

---

## TC-25 — SPA / query URL is a different page key in the same tab file

- **id:** TC-25
- **title:** Canonical URL splits pages inside one tab file
- **status:** HOST
- **precondition:** Native host working. Fixture server running.
- **steps:**
  1. On `http://127.0.0.1:8765/annotate.html` save one comment.
  2. Navigate the same tab to `http://127.0.0.1:8765/annotate.html?utm_source=test&x=1`.
  3. Save another comment.
  4. `list --tab <id>` and `list --tab <id> --url 'http://127.0.0.1:8765/annotate.html?x=1'`.
- **expected:** `utm_source` is stripped; `x=1` is kept. Two `pages` keys in the tab JSON. `--url` filters to one page. Pins only show for the current canonical URL.

---

## TC-26 — Restricted capture / host disconnect mid-save

- **id:** TC-26
- **title:** Screenshot failure still keeps the comment when host is up
- **status:** HOST
- **precondition:** Native host working.
- **steps:**
  1. Scroll a target fully off-screen if possible, or force `captureVisibleTab` to fail (e.g. comment on a window that is not the focused Chrome window).
  2. Save a comment.
- **expected:** Thread still appears. CLI may show `[无截图]`. Composer must not drop the text because the PNG failed. If the host disconnects entirely, error matches TC-18.

---

## TC-27 — CLI reply / resolve / open --tab

- **id:** TC-27
- **title:** Agent-facing CLI after a copied prompt
- **status:** HOST (`open --tab` also needs Chrome connected to the Unix socket)
- **precondition:** A saved thread id from `list --json`. Chrome still running with the extension loaded (for `open`).
- **steps:**
  1. `node dist/cli.js list --tab <id> --json`
  2. `node dist/cli.js reply <threadId> '已处理'`
  3. `node dist/cli.js resolve <threadId>`
  4. `node dist/cli.js open --tab <id>`
- **expected:**
  - JSON includes `screenshotAbs`, `quote`, comments.
  - Reply stored as author `agent`.
  - Resolve sets status `resolved`.
  - `open --tab` focuses that Chrome tab (`ok`) if the socket exists; otherwise exit 1: **Chrome 未连接本地宿主。请先打开 Chrome 并确保扩展已加载。请先查看该评论的截图。**

---

## TC-28 — Skill prompt handoff (no Agent login)

- **id:** TC-28
- **title:** Copied `/dom-comment tabid:…` is enough for the Skill/CLI
- **status:** READY for copy; HOST for `list` to return rows
- **precondition:** None for copy. Host + a saved thread for the list half.
- **steps:**
  1. Copy the skill prompt via context menu.
  2. Run the equivalent CLI (`list --tab <id> [--url …] --open`).
- **expected:** No ChatGPT/Claude/Feishu login. No “send to agent” button in the extension. The human pastes the line into an Agent. This case does **not** require a vendor credential.

---

## Environment notes for the tester

| Item | Value |
| --- | --- |
| Load unpacked | `dist/chrome-mv3` |
| Developer mode | Required |
| Extra flags | None |
| HTTP fixture | `python3 -m http.server 8765 --directory fixtures` |
| Official build dir | `dist/chrome-mv3` |
| CLI | `node dist/cli.js` |
| Storage (source tree) | `packages/dom-comment/data/` (`DOM_COMMENT_STORAGE_DIR` overrides) |
| Host install | macOS only in this build |
| Secrets | None |

