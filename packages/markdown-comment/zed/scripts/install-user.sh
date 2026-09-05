#!/usr/bin/env bash
# Install Markdown Comment Zed integration:
#   - copy helper into ~/.markdown-comment/zed
#   - merge Task into ~/.config/zed/tasks.json
#   - merge keybind (cmd-alt-m) into ~/.config/zed/keymap.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/.markdown-comment/zed"
ZED_DIR="${HOME}/.config/zed"
PREVIEW="${DEST}/scripts/preview.mjs"
LABEL="Markdown Comment: Preview current file"
KEY="cmd-alt-m"

mkdir -p "$DEST/scripts" "$ZED_DIR"
cp -f "$ROOT/scripts/preview.mjs" "$PREVIEW"
chmod +x "$PREVIEW"
cp -f "$ROOT/README.md" "$DEST/README.md"
cp -f "$ROOT/keybindings.example.json" "$DEST/keybindings.example.json"

python3 - <<PY
import json
from pathlib import Path

home = Path.home()
zed = home / ".config/zed"
preview = str(home / ".markdown-comment/zed/scripts/preview.mjs")
label = ${LABEL@Q}
key = ${KEY@Q}

# --- tasks.json ---
tasks_path = zed / "tasks.json"
task = {
    "label": label,
    "command": "node",
    "args": [preview, "\$ZED_FILE"],
    "use_new_terminal": True,
    "allow_concurrent_runs": False,
    "reveal": "always",
    "hide": "never",
}
existing = []
if tasks_path.exists() and tasks_path.read_text().strip():
    existing = json.loads(tasks_path.read_text())
    if not isinstance(existing, list):
        raise SystemExit(f"{tasks_path} must be a JSON array")
kept = [t for t in existing if t.get("label") != label]
tasks_path.write_text(json.dumps(kept + [task], indent=2, ensure_ascii=False) + "\n")
print(f"Updated {tasks_path}")

# --- keymap.json ---
keymap_path = zed / "keymap.json"
keymap = []
if keymap_path.exists() and keymap_path.read_text().strip():
    keymap = json.loads(keymap_path.read_text())
    if not isinstance(keymap, list):
        raise SystemExit(f"{keymap_path} must be a JSON array")

target = ["task::Spawn", {"task_name": label}]

def is_our_binding(val):
    return val == target or (
        isinstance(val, list)
        and len(val) == 2
        and val[0] == "task::Spawn"
        and isinstance(val[1], dict)
        and val[1].get("task_name") == label
    )

cleaned = []
for group in keymap:
    if not isinstance(group, dict):
        cleaned.append(group)
        continue
    bindings = group.get("bindings")
    if not isinstance(bindings, dict):
        cleaned.append(group)
        continue
    new_bindings = {
        k: v for k, v in bindings.items()
        if not (k == key or is_our_binding(v))
    }
    if not new_bindings and set(group.keys()) <= {"context", "bindings"}:
        # drop empty group we emptied
        continue
    g = dict(group)
    g["bindings"] = new_bindings
    cleaned.append(g)

cleaned.append({
    "context": "Editor && (markdown || Markdown)",
    "bindings": {key: target},
})
keymap_path.write_text(json.dumps(cleaned, indent=2, ensure_ascii=False) + "\n")
print(f"Updated {keymap_path} ({key} → {label})")
print(f"CLI helper: {preview}")
PY

echo
echo "Done. In Zed open a .md file and press ${KEY} (macOS)."
echo "Or: task: spawn → “${LABEL}”"
