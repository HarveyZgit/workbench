#!/usr/bin/env bash
# Install Markdown Comment Zed integration into ~/.markdown-comment/zed
# and merge a Task into ~/.config/zed/tasks.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/.markdown-comment/zed"
ZED_DIR="${HOME}/.config/zed"
TASKS="${ZED_DIR}/tasks.json"
PREVIEW="${DEST}/scripts/preview.mjs"

mkdir -p "$DEST/scripts" "$ZED_DIR"
cp -f "$ROOT/scripts/preview.mjs" "$PREVIEW"
chmod +x "$PREVIEW"
cp -f "$ROOT/README.md" "$DEST/README.md"
cp -f "$ROOT/keybindings.example.json" "$DEST/keybindings.example.json"

python3 - <<PY
import json
from pathlib import Path
home = Path.home()
tasks_path = home / ".config/zed/tasks.json"
preview = str(home / ".markdown-comment/zed/scripts/preview.mjs")
label = "Markdown Comment: Preview current file"
task = {
    "label": label,
    "command": "node",
    "args": [preview, "\$ZED_FILE"],
    "use_new_terminal": true,
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
merged = kept + [task]
tasks_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
print(f"Updated {tasks_path}")
print(f"CLI helper: {preview}")
PY

# rewrite keybindings example to match the single label
python3 - <<'PY'
from pathlib import Path
home = Path.home()
kb = home / ".markdown-comment/zed/keybindings.example.json"
kb.write_text(
    """[
  {
    "context": "Editor",
    "bindings": {
      "cmd-alt-m": ["task::Spawn", { "task_name": "Markdown Comment: Preview current file" }]
    }
  }
]
""",
    encoding="utf-8",
)
print(f"Wrote {kb}")
PY

echo
echo "Done. In Zed: task: spawn → “Markdown Comment: Preview current file”"
echo "Optional: zed: open keymap → merge bindings from $DEST/keybindings.example.json"
