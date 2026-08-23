## MODIFIED Requirements

### Requirement: Toolbar popup launches; page queue owns the list
The toolbar action MUST keep a default popup. The popup MUST start or stop annotation, show the current tab open-comment count, and copy `/dom-comment tabid:<id>` (with `url:` when the tab is http(s)). A control MAY reveal the in-page queue by turning annotation mode on.

#### Scenario: Start from popup
- **WHEN** annotation mode is off and the user clicks 「开始标记」
- **THEN** annotation mode turns on and the in-page queue is shown on the active http(s) tab

### Requirement: Esc hides annotation UI
Esc with the composer closed MUST turn annotation mode off. Pins, region overlays, the banner, and the in-page queue MUST be removed from the page. Comments MUST remain in storage.

#### Scenario: Exit hides pins
- **WHEN** two comments exist and the user presses Esc with no composer open
- **THEN** the page shows no annotation UI, and `list --tab` still returns those comments

### Requirement: Three gestures
While annotating, a click that is not a drag and has no text selection MUST open the composer for the target element. A non-empty text selection that is not a region drag MUST open a text comment. A pointer movement of at least 8 CSS pixels while pressed MUST start a region rubber-band without requiring Shift; release of a region at least 8×8 MUST open the area composer.

#### Scenario: Drag is region
- **WHEN** the user drags 20px without Shift and releases
- **THEN** the composer is an area comment

### Requirement: Copy is a skill locator
Copying for Agent MUST put `/dom-comment tabid:<tabId>` on the clipboard, and MUST append ` url:<canonical>` when the current page is http(s). It MUST NOT copy full comment bodies or Markdown dumps.

#### Scenario: Copy from queue
- **WHEN** the user clicks 「复制给 Agent」 on tab 1847 at `https://ex.com/app`
- **THEN** the clipboard is `/dom-comment tabid:1847 url:https://ex.com/app`
