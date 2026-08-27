#!/usr/bin/env bash
# Build a GitHub Release npm pack tarball from the package root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

if [[ ! -f "$DIST/cli.js" || ! -f "$DIST/chrome-mv3/manifest.json" ]]; then
  printf 'missing build; run: node scripts/build-node.mjs\n' >&2
  exit 1
fi

rm -rf "$DIST/release-stage"
rm -f "$DIST/dom-comment.zip" "$DIST"/dom-comment-*.tgz

tgz_name=""
while IFS= read -r line; do
  [[ -n "$line" ]] && tgz_name="$line"
done < <(cd "$ROOT" && npm pack --pack-destination "$DIST")

if [[ -z "$tgz_name" ]]; then
  printf 'produced no tarball\n' >&2
  exit 1
fi
if [[ "$tgz_name" != /* ]]; then
  tgz_name="$DIST/$tgz_name"
fi
printf '%s\n' "$tgz_name"
