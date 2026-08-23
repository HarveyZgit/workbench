## ADDED Requirements

### Requirement: Tab file is the storage unit
The system SHALL persist comments in one JSON file per Chrome tab id under the current session’s storage directory. The file SHALL contain `version`, `tabId`, `sessionId`, `updatedAt`, and `pages` keyed by canonical URL. Threads for different URLs in the same tab MUST live in the same file. Two tabs with the same URL MUST NOT share a file.

#### Scenario: First comment on a tab
- **WHEN** a thread is created for tab `1847` and no `1847.json` exists
- **THEN** the store writes `{storageDir}/1847.json` with that tabId and an empty-to-one `pages` map containing the canonical URL

#### Scenario: Same tab navigates
- **WHEN** a second thread is created on the same tab id for a different canonical URL
- **THEN** both pages remain in `1847.json` as separate `pages` entries

### Requirement: Session rotation on tabId reuse
The system SHALL stamp each tab file with `sessionId`. When saving a tab whose existing file has a different `sessionId` than the current session, the system MUST move the old JSON and screenshot directory to `archive/{oldSession}-{tabId}` before writing the new file. CLI reads MUST use the current session only and MUST NOT scan `archive/` by default.

#### Scenario: Chrome restart reuses tab id
- **WHEN** current session is `S2` and `1847.json` exists with `sessionId` `S1`
- **THEN** save rotates the old file into `archive/S1-1847.json` (and the screenshot dir if present) and writes a new `1847.json` for `S2`

### Requirement: Canonical URL page keys
Page keys MUST be the output of `canonicalizeUrl`: http(s) only; lowercase host; strip default ports; strip trailing slash except origin `/`; drop tracking query keys matching `utm_|gclid|fbclid|msclkid|mc_eid`; drop hash unless it starts with `#/` or `#!/`.

#### Scenario: Tracking query stripped
- **WHEN** the raw href is `https://ex.com/app/?utm_source=x&id=1#section`
- **THEN** the page key is `https://ex.com/app?id=1`

### Requirement: Screenshot path beside the tab file
Each thread SHALL have a `screenshot` string. When a PNG is stored it MUST be written at `{storageDir}/{tabId}/{sha1(canonicalUrl)}/{threadId}.png` and `screenshot` MUST be the relative path `{urlHash}/{threadId}.png`. JSON MUST NOT embed PNG bytes. Empty string means no screenshot.

#### Scenario: Thread with image
- **WHEN** createThread is given PNG bytes
- **THEN** the PNG file exists at that path and the thread’s `screenshot` field equals `{urlHash}/{threadId}.png`

### Requirement: In-place ops and field preservation
`createThread`, `reply`, `resolve`, and `updateRelocate` MUST mutate the loaded tab object in place (`returned.tab === input`). `reply` MUST NOT clear `screenshot`, `relocateStatus`, other pages, or `pages[url].title`. Missing or invalid JSON MUST load as an empty tab file (`pages: {}`). A tab whose every page has zero threads MUST delete the JSON file and screenshot directory.

#### Scenario: Reply keeps screenshot
- **WHEN** a thread has `screenshot` and `relocateStatus` and an Agent replies
- **THEN** those fields are still present after save and reload

#### Scenario: Empty body rejected
- **WHEN** createThread or reply is called with a whitespace-only body
- **THEN** the operation MUST fail and MUST NOT write a new comment
