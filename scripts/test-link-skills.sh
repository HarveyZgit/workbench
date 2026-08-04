#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINKER="$REPO_ROOT/scripts/link-skills.sh"
SKILLS_SRC="$REPO_ROOT/resources/skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'test failed: %s\n' "$*" >&2
  exit 1
}

expect_failure() {
  if "$@" >"$TMP/failure.out" 2>"$TMP/failure.err"; then
    fail "expected command to fail: $*"
  fi
}

TARGET_A="$TMP/target with space"
TARGET_B="$TMP/target-b"

expect_failure bash "$LINKER"
expect_failure bash "$LINKER" --target --dry-run
grep -q 'missing value for --target' "$TMP/failure.err" || fail 'missing target error is unclear'

bash "$LINKER" --target "$TARGET_A" --target "$TARGET_B" >/dev/null
[[ "$(readlink "$TARGET_A/review-and-commit")" == "$SKILLS_SRC/review-and-commit" ]] || fail 'target A link is wrong'
[[ "$(readlink "$TARGET_B/session-handoff")" == "$SKILLS_SRC/session-handoff" ]] || fail 'target B link is wrong'
[[ ! -e "$TARGET_A/markdown-comment" ]] || fail 'package-managed skill must not be linked'

# Idempotent rerun.
bash "$LINKER" --target "$TARGET_A" >/dev/null

# Migrate the exact historical broken link even when its intermediate target is gone.
rm "$TARGET_A/review-and-commit"
ln -s '../../.agents/skills/review-and-commit' "$TARGET_A/review-and-commit"
bash "$LINKER" --target "$TARGET_A" >/dev/null
[[ "$(readlink "$TARGET_A/review-and-commit")" == "$SKILLS_SRC/review-and-commit" ]] || fail 'legacy link was not migrated'

# A link to a different source skill is foreign and must remain untouched.
rm "$TARGET_A/review-and-commit"
ln -s "$SKILLS_SRC/session-handoff" "$TARGET_A/review-and-commit"
bash "$LINKER" --target "$TARGET_A" >/dev/null
[[ "$(readlink "$TARGET_A/review-and-commit")" == "$SKILLS_SRC/session-handoff" ]] || fail 'wrong-skill link was overwritten'

# Unknown broken links are foreign and must remain untouched.
rm "$TARGET_A/review-and-commit"
ln -s '../../.other/skills/review-and-commit' "$TARGET_A/review-and-commit"
bash "$LINKER" --target "$TARGET_A" >/dev/null
[[ "$(readlink "$TARGET_A/review-and-commit")" == '../../.other/skills/review-and-commit' ]] || fail 'foreign broken link was overwritten'

echo 'link-skills tests passed'
