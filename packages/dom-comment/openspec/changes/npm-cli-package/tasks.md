## 1. Package

- [x] 1.1 Publishable package.json (`files`, bin, version) and build extension into `dist/chrome-mv3`
- [x] 1.2 User-data storage for npm installs; keep package `data/` in the source tree
- [x] 1.3 Skill locator finds `dist/cli.js` from the installed package

## 2. CLI

- [x] 2.1 `install` registers host and interactively (or `--target`) links Skill
- [x] 2.2 `extension` prints the packed extension directory
- [x] 2.3 Runtime commands stay on the same binary; `setup` aliases `install`

## 3. Docs and tests

- [x] 3.1 README / AGENTS / OpenSpec config
- [x] 3.2 Tests for extension path, skill-root detection, and `--target` install

## 4. GitHub Release

- [x] 4.1 `scripts/pack-release.sh` builds `dist/dom-comment-*.tgz`
- [x] 4.2 Users install the tarball globally, then run `dom-comment install`
