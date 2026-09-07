#!/usr/bin/env bash
# Build a GitHub Release npm pack tarball from the package root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

if [[ ! -f "$DIST/cli.js" || ! -f "$DIST/webview.js" ]]; then
  printf 'missing build; run: node esbuild.mjs --production\n' >&2
  exit 1
fi

rm -f "$DIST/vscode-markdown-comment.vsix" "$DIST"/vscode-markdown-comment-*.tgz

npx --no-install vsce package --no-dependencies --ignoreFile .vscodeignore -o "$DIST/vscode-markdown-comment.vsix"

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
printf '%s\n' "$DIST/vscode-markdown-comment.vsix"
