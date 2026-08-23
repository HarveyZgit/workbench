## MODIFIED Requirements

### Requirement: New threads are stored immediately
`createThread` MUST persist the thread in the tab JSON (and screenshot tree) as soon as the user submits a non-empty comment. The thread MUST be visible to CLI `list` without a separate publish step. `createThread` MUST assign a positive `number` on that page.

#### Scenario: First comment is listable
- **WHEN** a thread is created
- **THEN** `list --tab` for that tab includes the thread

### Requirement: Delete removes the thread
Deleting a thread MUST remove it and its screenshot file from the tab store.

#### Scenario: Delete last thread
- **WHEN** the only thread on a tab is deleted
- **THEN** the tab JSON is empty or removed
