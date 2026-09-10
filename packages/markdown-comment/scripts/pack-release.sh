#!/usr/bin/env bash
# Build a zero-dependency npm pack tarball (markdown-comment-<ver>.tgz) that ships:
#   - bundled CLI (dist/cli.js + preview web assets)
#   - VS Code VSIX (dist/vscode-markdown-comment.vsix)
#   - Zed Install Dev Extension directory (zed/)
# After: npm i -g ./markdown-comment-<ver>.tgz
# then:  markdown-comment extension zed|vscode  prints absolute paths inside the install.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/npm-stage"
VSCE="$ROOT/node_modules/@vscode/vsce/vsce"

cd "$ROOT"

if [[ ! -f "$DIST/cli.js" || ! -f "$DIST/webview.js" ]]; then
  printf 'building…\n' >&2
  node esbuild.mjs --production
fi

if [[ ! -f "$VSCE" ]]; then
  printf 'missing @vscode/vsce; run rush update / npm install in this package\n' >&2
  exit 1
fi

printf 'packaging VSIX…\n' >&2
node "$VSCE" package --no-dependencies --ignoreFile .vscodeignore -o "$DIST/vscode-markdown-comment.vsix"

if [[ ! -f "$DIST/vscode-markdown-comment.vsix" ]]; then
  printf 'VSIX missing after vsce package\n' >&2
  exit 1
fi
if [[ ! -f "$ROOT/zed/extension.toml" ]]; then
  printf 'zed/extension.toml missing\n' >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
SRC_NAME="$(node -p "require('./package.json').name")"

rm -rf "$STAGE"
mkdir -p "$STAGE/dist" "$STAGE/zed"

# Rewritten package.json for the npm CLI tarball:
# - publish name markdown-comment → tarball markdown-comment-<ver>.tgz
# - empty dependencies (CLI/webview already bundled by esbuild)
# - explicit files so the global install carries zed/ + vsix
node << NODE
const fs = require('fs');
const src = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkg = {
  name: 'markdown-comment',
  version: src.version,
  description: src.description,
  license: src.license || 'MIT',
  repository: src.repository,
  engines: { node: (src.engines && src.engines.node) || '>=22' },
  bin: { 'markdown-comment': './dist/cli.js' },
  files: [
    'dist/cli.js',
    'dist/webview.js',
    'dist/webview.css',
    'dist/assets/',
    'dist/vscode-markdown-comment.vsix',
    'dist/resources/',
    'dist/skill-hub/',
    'zed/',
    'media/',
    'README.md',
  ],
  // Keep VS Code contributes out of the CLI npm package — install VS Code via the shipped VSIX.
  keywords: ['markdown', 'comment', 'cli', 'zed', 'vscode'],
};
fs.writeFileSync('$STAGE/package.json', JSON.stringify(pkg, null, 2) + '\n');
NODE

cp -a "$DIST/cli.js" "$DIST/webview.js" "$DIST/webview.css" "$STAGE/dist/"
cp -a "$DIST/vscode-markdown-comment.vsix" "$STAGE/dist/"
[[ -d "$DIST/assets" ]] && cp -a "$DIST/assets" "$STAGE/dist/"
[[ -d "$DIST/resources" ]] && cp -a "$DIST/resources" "$STAGE/dist/"
[[ -d "$DIST/skill-hub" ]] && cp -a "$DIST/skill-hub" "$STAGE/dist/"
[[ -d "$ROOT/media" ]] && cp -a "$ROOT/media" "$STAGE/"
cp -a "$ROOT/README.md" "$STAGE/README.md"

# Zed extension tree (skip build artifacts).
while IFS= read -r -d '' f; do
  rel="${f#"$ROOT/zed/"}"
  case "$rel" in
    target/*|*.wasm) continue ;;
  esac
  dest="$STAGE/zed/$rel"
  mkdir -p "$(dirname "$dest")"
  cp -a "$f" "$dest"
done < <(find "$ROOT/zed" -type f -print0)

chmod 755 "$STAGE/dist/cli.js"

rm -f "$DIST"/markdown-comment-*.tgz "$DIST"/vscode-markdown-comment-*.tgz

printf 'npm pack (name=markdown-comment source=%s ver=%s)…\n' "$SRC_NAME" "$VERSION" >&2
tgz_name=""
while IFS= read -r line; do
  [[ -n "$line" ]] && tgz_name="$line"
done < <(cd "$STAGE" && npm pack --pack-destination "$DIST")

if [[ -z "$tgz_name" ]]; then
  printf 'produced no tarball\n' >&2
  exit 1
fi
if [[ "$tgz_name" != /* ]]; then
  tgz_name="$DIST/$tgz_name"
fi

printf '%s\n' "$tgz_name"
printf '%s\n' "$DIST/vscode-markdown-comment.vsix"
