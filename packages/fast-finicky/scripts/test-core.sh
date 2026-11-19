#!/usr/bin/env bash
# Portable acceptance: no real browsers, user profiles, or GUI access.
set -euo pipefail
cd "$(dirname "$0")/.."
swift --version
# Keep test caches local, including in read-only-home cloud sandboxes.
cache_args=(--cache-path .build/swiftpm-cache --config-path .build/swiftpm-config --security-path .build/swiftpm-security)
swift build "${cache_args[@]}" --target FastFinickyCore
swift test "${cache_args[@]}"
node --test scripts/test-ego-opener.mjs
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Core checks only: macOS application build and native browser acceptance remain required.'
fi
