## ADDED Requirements

### Requirement: Toolbar opens a popup not annotation mode
The extension action MUST use a default popup. Clicking the toolbar MUST NOT toggle annotation mode by itself. The popup MUST contain an icon control to start or stop annotation and two copyable prompts for the current window’s active tab: `/dom-comment tabid:<id>` and `/dom-comment tabid:<id> url:<canonical>`. Copy text MUST include the `tabid:` token. If the tab URL is not http(s), the page prompt MUST be disabled with copy 「当前页不能标注」.

#### Scenario: Start from popup
- **WHEN** annotation mode is off and the user clicks 「开始标记」
- **THEN** the extension sets global annotation mode on, updates the action icon to X, and the popup may close

### Requirement: Esc and on-page hint
While annotation mode is on, each http(s) tab MUST show a non-interactive banner 「标注中 · 按 Esc 退出」. Esc with the composer closed MUST turn annotation mode off globally. Esc with the composer open MUST close the composer only. Esc while dragging MUST cancel the rubber-band and keep annotation mode on.

#### Scenario: Double Esc
- **WHEN** the composer is open and the user presses Esc then Esc again
- **THEN** the first press closes the composer and the second press exits annotation mode

### Requirement: Element click and area drag
In annotation mode, hovering a targetable element MUST show a blue outline. A click that is not a drag MUST open the composer for that element. A pointer movement of at least 8 CSS pixels while pressed MUST start an area rubber-band; on release of a region at least 8×8 document pixels the composer MUST open for that area. Smaller movement MUST remain an element click.

#### Scenario: Jitter is still an element comment
- **WHEN** the user presses, moves 3px, and releases on a button
- **THEN** the composer is an element comment on that button, not an area

### Requirement: Composer creates one thread
The composer SHALL use Chinese copy 「添加评论」 / 「写下评论…」 / 「发送」. Empty body MUST not save. Successful save MUST close the composer and keep annotation mode on. Saving MUST send `CREATE_THREAD` with `tabId`, canonical URL, title, captured target, viewport `cropRect`, and body. A second save on the same element MUST create a new thread.

#### Scenario: Empty send
- **WHEN** the user clicks 发送 with only whitespace
- **THEN** no host write occurs and the composer stays open

### Requirement: Native host writes files
The extension MUST NOT write `~/.dom-comment` itself. Create/load/save MUST go through the native messaging host. If the host is missing, the composer MUST show Chinese install instructions and MUST NOT stash the draft in `chrome.storage`.

#### Scenario: Host missing
- **WHEN** native messaging fails because the host is not installed
- **THEN** the composer shows Chinese text telling the user to run `dom-comment install-host` and the comment body is not written to `chrome.storage`
