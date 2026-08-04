#!/usr/bin/env bash
#
# link-skills.sh — install this repo's pure workflow skills into explicitly
# configured skill directories.
#
# Every target links directly to the repository source:
#   <target-dir>/<name> -> <repo>/resources/skills/<name>
#
# Safety: only ever create/refresh symlinks that we manage. Never delete a real
# file/dir or a symlink that points somewhere we don't recognize.
#
# Usage:
#   scripts/link-skills.sh [--dry-run] --target <skill-dir> [--target <skill-dir> ...]
#
# Targets may also be supplied with AI_WORKBENCH_SKILL_DIRS, separated by the
# platform PATH delimiter (":" on macOS/Linux).

set -euo pipefail

DRY_RUN=0
TARGET_DIRS=()

usage() {
  cat <<'EOF'
Usage: scripts/link-skills.sh [--dry-run] --target <skill-dir> [--target <skill-dir> ...]

Alternatively set AI_WORKBENCH_SKILL_DIRS to a colon-separated target list.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --target)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || {
        printf 'missing value for --target\n' >&2
        usage >&2
        exit 2
      }
      TARGET_DIRS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "${AI_WORKBENCH_SKILL_DIRS:-}" ]]; then
  IFS=':' read -r -a configured_targets <<< "$AI_WORKBENCH_SKILL_DIRS"
  for target in "${configured_targets[@]}"; do
    [[ -n "$target" ]] && TARGET_DIRS+=("$target")
  done
fi

if [[ ${#TARGET_DIRS[@]} -eq 0 ]]; then
  printf 'no skill target configured\n' >&2
  usage >&2
  exit 2
fi

for index in "${!TARGET_DIRS[@]}"; do
  TARGET_DIRS[$index]="${TARGET_DIRS[$index]/#\~/$HOME}"
done

# Resolve repo root from this script's location (scripts/ is at repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/resources/skills"

log()  { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    step "[dry-run] $*"
  else
    "$@"
  fi
}

# Create/refresh a symlink at $dest pointing to $target, but only if it is safe.
# Cases:
#   - missing              -> create
#   - our own link (target matches / ours) -> refresh if target differs, else ok
#   - foreign symlink      -> warn + skip (never delete a link we don't own)
#   - real file/dir        -> warn + skip (never delete user data)
is_ours() {
  local current="$1" dest="$2" target="$3"
  local name
  name="$(basename "$dest")"
  [[ "$current" == "$SKILLS_SRC/$name" ]] && return 0
  [[ "$current" == "../../.agents/skills/$name" ]] && return 0
  [[ -e "$dest" ]] && [[ "$(cd "$(dirname "$dest")" && realpath "$(basename "$dest")")" == "$target" ]]
}

safe_link() {
  local target="$1" dest="$2"
  if [[ -L "$dest" ]]; then
    local current
    current="$(readlink "$dest")"
    if [[ "$current" == "$target" ]]; then
      step "ok (already linked): $dest"
      return 0
    fi
    if is_ours "$current" "$dest" "$target"; then
      step "refresh: $dest ($current -> $target)"
      run rm "$dest"
      run ln -s "$target" "$dest"
    else
      step "SKIP (foreign symlink, not touching): $dest -> $current"
    fi
    return 0
  fi
  if [[ -e "$dest" ]]; then
    step "SKIP (real file/dir exists, not touching): $dest"
    return 0
  fi
  step "link: $dest -> $target"
  run ln -s "$target" "$dest"
}

log "repo skills: $SKILLS_SRC"
[[ $DRY_RUN -eq 1 ]] && log "(dry-run: no changes will be made)"

for d in "${TARGET_DIRS[@]}"; do
  run mkdir -p "$d"
done

shopt -s nullglob
for skill_path in "$SKILLS_SRC"/*/; do
  name="$(basename "$skill_path")"
  skill_path="${skill_path%/}"

  [[ -f "$skill_path/SKILL.md" ]] || continue

  log ""
  log "skill: $name"

  for d in "${TARGET_DIRS[@]}"; do
    safe_link "$skill_path" "$d/$name"
  done
done

log ""
log "done."
