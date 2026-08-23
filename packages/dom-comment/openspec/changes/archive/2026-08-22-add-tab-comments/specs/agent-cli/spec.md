## ADDED Requirements

### Requirement: List by tab then URL
The CLI SHALL list threads with `dom-comment list --tab <id> [--url <canonical>]`. `--tab` is required unless listing is implied by a parsed `tabid:` token in a wrapper; the default invocation without `--tab` MUST NOT dump every tab. With `--url`, only that page in that tab is listed. Without `--url`, all pages in the tab file are listed, newest `updatedAt` first. `--open` hides resolved threads. `--hidden` includes threads with `relocateStatus.state === 'orphaned'`; otherwise orphaned threads are omitted. Threads without `relocateStatus` MUST be shown.

#### Scenario: Tab list
- **WHEN** the user runs `dom-comment list --tab 1847`
- **THEN** stdout groups threads by canonical URL under `tab 1847` and does not print other tab ids

#### Scenario: Missing tab is empty not crash
- **WHEN** `list --tab 1847` and no current-session file exists
- **THEN** the CLI exits 0 with a Chinese empty message

### Requirement: Compact human list and JSON
Human list lines MUST label `[元素]` or `[区域]`, clip quote to 30 folded characters, show 8-char thread id, and mark `[截图]` or `[无截图]`. `--json` MUST include `tabId`, `url`, `threadId`, `quote`, `comments`, and `screenshotAbs` (absolute path or empty) and MUST NOT print PNG bytes.

#### Scenario: JSON points at the file
- **WHEN** a thread has screenshot `abc/{id}.png`
- **THEN** `--json` `screenshotAbs` is the absolute path under the tab screenshot directory

### Requirement: Reply and resolve by thread id
`reply <threadId> <text>` SHALL append a comment with `author` exactly `agent`. `resolve <threadId>` SHALL set `status` to `resolved`. Thread lookup MUST scan all current-session tab files; full id wins; an unambiguous prefix is allowed; 0 or >1 matches MUST fail with exit code 1.

#### Scenario: Short id
- **WHEN** exactly one thread id starts with `43201ada`
- **THEN** `reply 43201ada "ok"` appends an agent comment to that thread

### Requirement: Open focuses the original tab only
`open --tab <id>` SHALL send a focus request to the running extension via the local Unix socket and MUST NOT launch Playwright, MUST NOT attach CDP, MUST NOT create a new tab, and MUST NOT fetch the page. If the socket is missing or the tab is gone, the CLI MUST exit 1 with Chinese text telling the user to look at the screenshot.

#### Scenario: Chrome not connected
- **WHEN** `~/.dom-comment/host.sock` does not exist
- **THEN** `open --tab 1847` exits 1 and mentions 截图

### Requirement: Skill uses CLI and parameter-first lookup
The package Skill MUST instruct the Agent to parse `tabid:` and `url:` before other natural language, to call the public CLI only, to read screenshot files from `screenshotAbs`, and to forbid Playwright, CDP, and fetching the URL as source of truth.

#### Scenario: Pasted prompt
- **WHEN** the user message contains `/dom-comment tabid:1847 url:https://example.com/app`
- **THEN** the Skill flow uses `list --tab 1847 --url https://example.com/app` (after canonicalize if needed)
