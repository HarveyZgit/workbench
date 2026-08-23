#!/usr/bin/env bash
# Download the GitHub Release zip (or use a local tree/zip) and install CLI + files.
# Then runs `dom-comment install` unless --skip-setup.
set -euo pipefail

REPO="${DOM_COMMENT_REPO:-HarveyZgit/workbench}"
ASSET_NAME="dom-comment.zip"
SKIP_SETUP=0
FROM_DIR=""
ZIP_PATH=""
SETUP_ARGS=()

usage() {
  cat <<'EOF'
Usage: install.sh [--zip <file>] [--from-dir <dir>] [--skip-setup] [--target <skill-root>]...

Downloads the latest GitHub Release asset named dom-comment.zip unless --zip or --from-dir is set.
Installs into $DOM_COMMENT_PREFIX (default: ~/Library/Application Support/dom-comment/pkg on macOS)
and links $DOM_COMMENT_BIN_DIR/dom-comment (default: ~/.local/bin/dom-comment).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --skip-setup)
      SKIP_SETUP=1
      shift
      ;;
    --from-dir)
      [[ $# -ge 2 ]] || { printf 'missing value for --from-dir\n' >&2; exit 2; }
      FROM_DIR="$2"
      shift 2
      ;;
    --zip)
      [[ $# -ge 2 ]] || { printf 'missing value for --zip\n' >&2; exit 2; }
      ZIP_PATH="$2"
      shift 2
      ;;
    --target)
      [[ $# -ge 2 ]] || { printf 'missing value for --target\n' >&2; exit 2; }
      SETUP_ARGS+=(--target "$2")
      shift 2
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" == Darwin ]]; then
  DEFAULT_PREFIX="$HOME/Library/Application Support/dom-comment"
else
  DEFAULT_PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/dom-comment"
fi
PREFIX="${DOM_COMMENT_PREFIX:-$DEFAULT_PREFIX}"
PKG="$PREFIX/pkg"
BIN_DIR="${DOM_COMMENT_BIN_DIR:-$HOME/.local/bin}"

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    printf '需要 Node.js 22+。请先安装 node。\n' >&2
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -lt 22 ]]; then
    printf '需要 Node.js 22+，当前是 %s。\n' "$(node -v)" >&2
    exit 1
  fi
}

latest_zip_url() {
  python3 - "$REPO" "$ASSET_NAME" <<'PY'
import json, sys, urllib.request

repo, asset = sys.argv[1], sys.argv[2]
req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/releases",
    headers={"User-Agent": "dom-comment-install", "Accept": "application/vnd.github+json"},
)
with urllib.request.urlopen(req) as resp:
    releases = json.load(resp)
for rel in releases:
    if rel.get("draft") or rel.get("prerelease"):
        continue
    tag = rel.get("tag_name") or ""
    if not tag.startswith("dom-comment-v"):
        continue
    for item in rel.get("assets") or []:
        if item.get("name") == asset and item.get("browser_download_url"):
            print(item["browser_download_url"])
            sys.exit(0)
sys.stderr.write(
    f"在 GitHub {repo} 找不到 tag 为 dom-comment-v* 且含 {asset} 的 Release。\n"
)
sys.exit(1)
PY
}

copy_payload() {
  local src="$1"
  if [[ ! -f "$src/dist/cli.js" || ! -f "$src/chrome-extension.json" ]]; then
    printf '不是完整的 dom-comment 包：缺少 dist/cli.js 或 chrome-extension.json（%s）\n' "$src" >&2
    exit 1
  fi
  rm -rf "$PKG"
  mkdir -p "$PKG/dist" "$PKG/resources/skills"
  cp -R "$src/dist/." "$PKG/dist/"
  cp "$src/chrome-extension.json" "$PKG/"
  if [[ -d "$src/resources/skills/dom-comment" ]]; then
    cp -R "$src/resources/skills/dom-comment" "$PKG/resources/skills/"
  fi
  chmod 755 "$PKG/dist/cli.js" "$PKG/dist/native-host.js" 2>/dev/null || true
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/dom-comment-install.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

require_node

if [[ -n "$FROM_DIR" ]]; then
  copy_payload "$(cd "$FROM_DIR" && pwd)"
elif [[ -n "$ZIP_PATH" ]]; then
  unzip -q "$ZIP_PATH" -d "$TMP/unpacked"
  copy_payload "$TMP/unpacked"
else
  command -v curl >/dev/null 2>&1 || { printf '需要 curl。\n' >&2; exit 1; }
  command -v python3 >/dev/null 2>&1 || { printf '需要 python3 以便查找 GitHub Release。\n' >&2; exit 1; }
  url="$(latest_zip_url)"
  printf '下载 %s\n' "$url"
  curl -fsSL "$url" -o "$TMP/$ASSET_NAME"
  unzip -q "$TMP/$ASSET_NAME" -d "$TMP/unpacked"
  copy_payload "$TMP/unpacked"
fi

mkdir -p "$BIN_DIR"
ln -sfn "$PKG/dist/cli.js" "$BIN_DIR/dom-comment"
printf '已安装 CLI → %s/dom-comment\n' "$BIN_DIR"
printf '扩展目录：%s/dist/chrome-mv3\n' "$PKG"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf '请把 %s 加到 PATH。\n' "$BIN_DIR"
fi

if [[ "$SKIP_SETUP" -eq 0 ]]; then
  "$BIN_DIR/dom-comment" install "${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}"
fi
