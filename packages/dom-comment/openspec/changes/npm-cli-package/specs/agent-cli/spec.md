## ADDED Requirements

### Requirement: npm CLI installs skill to user-chosen agent directories
`dom-comment install` MUST register the Chrome Native Messaging host. It MUST install the Skill only into directories the user selects. Interactive mode MUST list existing `~/.<name>/skills` directories and accept extra paths. `--target` MUST skip the prompt and install to those directories. If stdin is not a TTY and no `--target` is given, Skill installation MUST be skipped. The command MUST NOT default to a vendor or host-specific skill path.

#### Scenario: Non-interactive target
- **WHEN** the user runs `dom-comment install --target /tmp/skills`
- **THEN** the Native Messaging host is registered and `/tmp/skills/dom-comment` is a symlink to this package's Skill source

#### Scenario: No TTY and no target
- **WHEN** `install` runs without `--target` and stdin is not a TTY
- **THEN** the host is still registered and no Skill symlink is created

### Requirement: extension command prints the packed extension directory
`dom-comment extension` MUST print the absolute path of the packaged Chrome MV3 directory (containing `manifest.json`) and exit 0 when that directory exists.

#### Scenario: Print path
- **WHEN** the user runs `dom-comment extension` after a successful build or npm install
- **THEN** stdout is one absolute path whose directory contains `manifest.json`
