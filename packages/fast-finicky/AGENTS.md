# Fast Finicky package guide

Read the repository-level [AGENTS.md](../../AGENTS.md) and this file before working here.

## Project Goal

A deliberately narrow macOS replacement for Finicky.

Scope:

- Route only to `Google Chrome`
- Choose a Chrome profile using simple `host + path` substring matching
- Stay menubar-only
- Keep the hot path as short as possible
- Avoid JS config, rewrite rules, short-link expansion, and general browser-routing features

Do not turn this into a general Finicky clone unless the user explicitly asks.

This package is a Swift app. Do not add a Node `package.json` or register it in Rush.

## Architecture

- `Sources/FastFinickyApp` — menubar app, Apple Event handling, file-opening entrypoints, menu actions
- `Sources/FastFinickyCore` — config loading, routing, logging, config watching, Chrome launching
- `Sources/FastFinickyCLI` — dry-run / debug CLI
- `App/Info.plist` — browser registration metadata and file-type declarations
- `App/Resources/app_icon.icns` — bundle / menu bar icon
- `scripts/build-app.sh` — builds `dist/Fast Finicky.app`

Key files:

- [AppDelegate.swift](Sources/FastFinickyApp/AppDelegate.swift)
- [BrowserLauncher.swift](Sources/FastFinickyCore/BrowserLauncher.swift)
- [RoutingEngine.swift](Sources/FastFinickyCore/RoutingEngine.swift)
- [ConfigStore.swift](Sources/FastFinickyCore/ConfigStore.swift)
- [DailyLogger.swift](Sources/FastFinickyCore/DailyLogger.swift)
- [ChromeWarmer.swift](Sources/FastFinickyCore/ChromeWarmer.swift)
- [Info.plist](App/Info.plist)

## Runtime Behavior

- Matching input is `lowercase(hostname + pathname)`
- Query and hash are ignored
- Rules are first-match-wins
- If no rule matches, use `defaultProfile`
- Config is loaded into memory and reloaded on file change
- Local files are supported through `openFile` / `openFiles`
- Menu actions are `Add Current Page…`, `Open Config`, `Reload Config`, `Setup`, `Open Log`, `Launch at Login`, `Quit`
- `Add Current Page…` is enabled when Google Chrome is running. It reads the active tab URL via AppleScript (TCC prompt) and prepends a rule. The contains field is prefilled with host + path for http(s)/file URLs. The profile popup prefers Chrome's last used profile.
- `Launch at Login` toggles a LaunchAgent at `~/Library/LaunchAgents/com.harvey.fastfinicky.plist` for the running `.app` (not a raw `swift run` binary). Enabling also removes the old `dev.fastfinicky.app` agent if present.
- `Setup` / `fast-finicky-cli --setup` scans Chrome user data and appends a rule for each unknown profile. New rules get empty `contains` (URL matching only); `name`/`email` are labels. Missing `name`/`email` on existing rules are filled from Chrome without changing `contains` or `profile`. Email comes from Local State `info_cache.user_name` (must contain `@`), then `{profile}/Preferences` `account_info[].email`. It never deletes rules.

Keep the hot path free of:

- network requests
- JS evaluation
- synchronous waiting for Chrome to finish launching

## Chrome Launch Strategy

The current launcher does **not** use `NSWorkspace.openURLs(...withApplicationAt:)` for real launches.

Reason:

- That approach was tried and built successfully, but it did not reliably preserve the requested Chrome profile.
- In practice it could launch the wrong profile because LaunchServices and Chrome instance reuse did not consistently honor the intended argument path.

The current implementation in [BrowserLauncher.swift](Sources/FastFinickyCore/BrowserLauncher.swift) is:

- if Chrome is already running, `profile.last_used` matches the target, and at most one profile has windows (`last_active_profiles`), hand the URL to that instance (`reuseRunningInstance`) — no new Chrome process
- otherwise, for web URLs, execute `Google Chrome.app/Contents/MacOS/Google Chrome` with `--profile-directory=<profile> <absolute-url>`
- for local files, keep using `/usr/bin/open -n -a <Chrome.app path> --args --profile-directory=<profile> <path>` (`-g` when Chrome is already running)
- activate Chrome only on a true cold start (not running yet); never activate an already-running instance right after spawn

Important details:

- Web URLs favor the shortest launch path that still preserves the profile.
- Local files still use the raw file path while routing continues to use the `file://` URL form.
- Profile correctness currently has priority over trying more "native" app-launch APIs.
- Activating a running Chrome immediately after spawn fronts existing windows before the URL arrives. That is the "focus, then wait, then open" symptom.
- `BrowserLauncher.launch(...)` returns structured metadata (`LaunchResult`) instead of only returning the app URL.

If you revisit performance work here, treat profile correctness as the non-negotiable constraint.

## Keep-Warm (cold-launch latency)

The `directBinary` path spawns the full Chrome binary so it can honor `--profile-directory`. Measured cost: ~0.1s warm, but ~6.8s when Chrome's shared framework (`Google Chrome Framework`, ~458 MB, profile-independent) has been evicted from the page cache after idle / memory pressure. This is the "runs a while, then clicks take 3-5s" symptom — and it is downstream of `process.run()`, so the route log's `elapsed_ms` does not capture it.

[ChromeWarmer.swift](Sources/FastFinickyCore/ChromeWarmer.swift) keeps that single shared framework resident, which covers every profile at once:

- `mmap`s the framework binary (shares Chrome's own physical pages — ~no extra private memory).
- On a 30s timer, checks residency with `mincore` first; only `madvise(WILLNEED)` + touches pages when a fraction has been evicted, so a warm tick is a near-free no-op.
- `warmNow()` is called after each launch to stay hot during active use.
- Backs the interval off (up to 300s) when eviction recurs, to avoid thrashing under real memory pressure; resets to 30s once warm again.
- Does not `mlock`/wire memory — pages stay reclaimable, so the OS can take them back under genuine pressure (the one case where a cold launch can still happen).
- Emits `warm` / `warm_error` log lines; warm ticks that change nothing stay silent.

Constraints if you touch this:

- Keep it profile-independent — there is no per-profile framework to warm, so do not add per-profile logic.
- Remap when `Versions/Current` changes device+inode; comparing the unresolved path string is not enough after a Chrome update.
- Tear down the mmap on the isolation queue (`stop()` / `deinit`). Off-queue `munmap` races the timer.
- `reuseRunningInstance` is safe only when `profile.last_used` matches the target and at most one profile currently has windows. LaunchServices without a new instance cannot pick a profile.

## Config And Logs

Config file:

- `~/.config/fast-finicky/config.json`

Logs:

- `~/.local/state/fast-finicky/logs/YYYY-MM-DD.log`

Behavior:

- First run bootstraps a JSON config from the user's translated Finicky rules
- Invalid reloads should not destroy the last good in-memory config
- Logs are daily and old files are pruned after 7 days
- `Open Log` should open today's log file directly
- Route logs include launch-path metadata so hot-path changes can be compared from logs instead of only by feel

Do not reintroduce `.finicky.js` compatibility unless asked.

## Browser Registration Notes

[Info.plist](App/Info.plist) includes:

- `http` / `https` URL handling
- `public.html` / `public.xhtml` document types
- `NSUserActivityTypeBrowsingWeb`
- `CFBundleIconFile = app_icon.icns`

These declarations were adjusted to make the app appear as a browser choice in macOS and to avoid local HTML open failures. Be cautious when changing them.

## Build And Test

From this package directory:

```sh
swift test
./scripts/build-app.sh debug
```

App bundle output:

- `dist/Fast Finicky.app`

CLI examples:

```sh
swift run fast-finicky-cli --setup
swift run fast-finicky-cli --url 'https://people-byte-my.byteintl.com/path?q=1' --dry-run
swift run fast-finicky-cli --url 'https://people-byte-my.byteintl.com/path?q=1'
```

For sandboxed testing, `FAST_FINICKY_HOME` may be pointed to a writable temp/home override.

## Modification Guidelines

- Preserve the menubar-only UX unless the user asks for more UI
- Prefer explicit, boring config semantics over flexible abstractions
- Preserve profile correctness over speculative launch-path optimizations
- If changing browser launch behavior, test both normal web URLs and local HTML files
- Keep `Info.plist` browser declarations intact unless you are fixing a concrete registration problem
- If default-browser discoverability breaks, compare against original Finicky's plist shape before trying bigger changes
- Keep icon work limited to the menubar / bundle icon unless explicitly requested
- Avoid adding dependencies unless they clearly reduce complexity

## Acceptance Checks After Changes

Always try to verify:

- `swift test` passes
- `./scripts/build-app.sh debug` succeeds
- the app still writes config/log files
- a representative URL dry-run resolves to the expected Chrome profile
- Chrome is brought to the foreground after a launch
- route logs show the expected `launch_strategy` / `target_kind`

If browser-launch logic changed, also verify:

- the correct Chrome profile is used
- local `index.html` or another HTML file still opens
- the app still behaves as a valid browser handler for `http` / `https`
- web URLs still take the direct-binary path instead of silently falling back to `open`
