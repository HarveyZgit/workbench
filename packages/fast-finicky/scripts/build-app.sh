#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGURATION="${1:-release}"
APP_NAME="Fast Finicky.app"

cd "$ROOT_DIR"

swift build -c "$CONFIGURATION" --product FastFinicky
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"
APP_DIR="$ROOT_DIR/dist/$APP_NAME"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cp "$BIN_DIR/FastFinicky" "$APP_DIR/Contents/MacOS/FastFinicky"
cp "$ROOT_DIR/App/Info.plist" "$APP_DIR/Contents/Info.plist"
if [ -d "$ROOT_DIR/App/Resources" ]; then
  cp -R "$ROOT_DIR/App/Resources/." "$APP_DIR/Contents/Resources/"
fi

echo "Built $APP_DIR"
