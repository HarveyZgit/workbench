## ADDED Requirements

### Requirement: Cropped PNG at save time
When the user submits a comment, the extension MUST capture the visible tab, crop to the element or area box in viewport CSS pixels (intersected with the viewport; scroll into view first if fully off-screen), cap the longest CSS side at 1600px, and send PNG bytes to the host. The host MUST write the file under the tab/urlHash/threadId path. Capture failure MUST still persist the text thread with `screenshot` empty.

#### Scenario: Screenshot failure still saves
- **WHEN** `captureVisibleTab` fails and the body is non-empty
- **THEN** the thread is stored and `screenshot` is `''`

### Requirement: Focus original tab
`open --tab` MUST ask the extension to activate that `tabId` in the user’s running Chrome. The extension MUST use `tabs.update({ active: true })` and focus the window. It MUST NOT create a new tab, MUST NOT navigate, MUST NOT launch Playwright, and MUST NOT attach a debugger.

#### Scenario: Tab still open
- **WHEN** tab 1847 exists and the CLI runs `open --tab 1847`
- **THEN** that tab becomes the active tab in its window

#### Scenario: Tab gone
- **WHEN** tab 1847 does not exist
- **THEN** the CLI exits 1 and does not open another tab
