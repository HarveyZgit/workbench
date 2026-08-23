#!/usr/bin/env bash
# Build a GitHub Release zip: dist/, resources/skills/dom-comment, chrome-extension.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/release-stage"
ZIP="$DIST/dom-comment.zip"

if [[ ! -f "$DIST/cli.js" || ! -f "$DIST/chrome-mv3/manifest.json" ]]; then
  printf 'missing build; run: node scripts/build-node.mjs\n' >&2
  exit 1
fi

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/dist/chrome-mv3" "$STAGE/resources/skills"

cp "$DIST/cli.js" "$DIST/native-host.js" "$STAGE/dist/"
chmod 755 "$STAGE/dist/cli.js" "$STAGE/dist/native-host.js"
cp "$DIST/chrome-mv3/"*.js "$DIST/chrome-mv3/"*.html "$DIST/chrome-mv3/"*.png "$DIST/chrome-mv3/manifest.json" "$STAGE/dist/chrome-mv3/"
cp "$ROOT/chrome-extension.json" "$STAGE/"
cp -R "$ROOT/resources/skills/dom-comment" "$STAGE/resources/skills/"
chmod 755 "$STAGE/resources/skills/dom-comment/scripts/dom-comment"

(cd "$STAGE" && zip -qr "$ZIP" .)
rm -rf "$STAGE"
printf '%s\n' "$ZIP"
