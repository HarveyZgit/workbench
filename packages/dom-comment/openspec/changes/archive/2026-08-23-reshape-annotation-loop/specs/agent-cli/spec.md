## MODIFIED Requirements

### Requirement: List by tab, or recent comments without tab
`dom-comment list --tab <id>` MUST list that tab’s threads. `dom-comment list` without `--tab` MUST list recent open comments in the current session, newest first, and MUST NOT dump every historical tab unless they have comments. `--open` MUST hide `resolved` threads.

#### Scenario: Default list after save
- **WHEN** the user runs `dom-comment list --open` after saving a comment without publishing
- **THEN** stdout includes that comment

### Requirement: Skill uses the copied locator
The package Skill MUST parse `tabid:` and `url:` from the user message first. When those tokens are present, it MUST call `list --tab` (and `--url` if given). When they are absent, it MAY use `list --open`. Playwright, CDP, and fetching the page URL as source of truth remain forbidden.

#### Scenario: Pasted prompt
- **WHEN** the user message contains `/dom-comment tabid:1847 url:https://example.com/app`
- **THEN** the Skill flow uses `list --tab 1847 --url https://example.com/app`
