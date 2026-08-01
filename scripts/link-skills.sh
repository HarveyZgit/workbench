#!/usr/bin/env bash
#
# link-skills.sh — install this repo's pure workflow skills into the local Agent
# skill directories.
#
# Topology (matches the existing markdown-comment setup):
#   ~/.agents/skills/<name>   -> <repo>/resources/skills/<name>   (authoritative)
#   ~/.trae/skills/<name>     -> ../../.agents/skills/<name>       (relative)
#   ~/.claude/skills/<name>   -> ../../.agents/skills/<name>       (relative)
#
# ~/.agents is the authoritative copy; TRAE and Claude Code point back to it.
# For workflow skills we symlink ~/.agents straight at the repo so editing a
# SKILL.md here takes effect immediately (no reinstall).
#
# Package-bound skills — those whose SKILL.md contains a "{{" placeholder (e.g.
# markdown-comment, whose CLI path is injected at build time) — are SKIPPED here.
# They are installed by their own package build; we must not clobber a real copy.
#
# Safety: only ever create/refresh symlinks that we manage. Never delete a real
# file/dir or a symlink that points somewhere we don't recognize.
#
# Usage:
#   scripts/link-skills.sh [--dry-run]

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# Resolve repo root from this script's location (scripts/ is at repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/resources/skills"

# Authoritative dir + the agent dirs that link back to it.
AGENTS_DIR="$HOME/.agents/skills"
# Each entry links <dir>/<name> -> ../../.agents/skills/<name>
MIRROR_DIRS=(
  "$HOME/.trae/skills"
  "$HOME/.claude/skills"
  # Add more agent skill dirs here if needed, e.g. "$HOME/.codex/skills"
)

log()  { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    step "[dry-run] $*"
  else
    "$@"
  fi
}

# Is this skill a pure workflow skill? Package-bound skills use build-time
# placeholders shaped like {{CLI}} / {{BIN_PATH}} (double-brace + UPPER_SNAKE
# identifier). We match that exact shape rather than any "{{" so a workflow
# skill that merely documents the "{{ }}" convention in prose isn't misflagged.
is_workflow_skill() {
  local skill_md="$1/SKILL.md"
  [[ -f "$skill_md" ]] || return 1
  ! grep -Eq '\{\{[A-Z][A-Z0-9_]*\}\}' "$skill_md"
}

# Create/refresh a symlink at $dest pointing to $target, but only if it is safe.
# $kind is "authoritative" or "mirror" and controls what counts as a link we own:
#   - authoritative: a link into this repo's resources/skills ($SKILLS_SRC/*)
#   - mirror:        the relative link "../../.agents/skills/*" we create
# Cases:
#   - missing              -> create
#   - our own link (target matches / ours) -> refresh if target differs, else ok
#   - foreign symlink      -> warn + skip (never delete a link we don't own)
#   - real file/dir        -> warn + skip (never delete user data)
is_ours() {
  local kind="$1" current="$2"
  case "$kind" in
    authoritative) [[ "$current" == "$SKILLS_SRC"/* ]] ;;
    mirror)        [[ "$current" == ../../.agents/skills/* || "$current" == "$AGENTS_DIR"/* ]] ;;
    *) return 1 ;;
  esac
}

safe_link() {
  local target="$1" dest="$2" kind="$3"
  if [[ -L "$dest" ]]; then
    local current
    current="$(readlink "$dest")"
    if [[ "$current" == "$target" ]]; then
      step "ok (already linked): $dest"
      return 0
    fi
    if is_ours "$kind" "$current"; then
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

run mkdir -p "$AGENTS_DIR"
for d in "${MIRROR_DIRS[@]}"; do
  run mkdir -p "$d"
done

shopt -s nullglob
for skill_path in "$SKILLS_SRC"/*/; do
  name="$(basename "$skill_path")"
  skill_path="${skill_path%/}"

  log ""
  log "skill: $name"

  if ! is_workflow_skill "$skill_path"; then
    step "SKIP (package-bound, has {{ placeholder }} — managed by its build)"
    continue
  fi

  # 1) authoritative: ~/.agents/skills/<name> -> absolute repo path
  safe_link "$skill_path" "$AGENTS_DIR/$name" authoritative

  # 2) mirrors: <dir>/<name> -> ../../.agents/skills/<name>
  for d in "${MIRROR_DIRS[@]}"; do
    safe_link "../../.agents/skills/$name" "$d/$name" mirror
  done
done

log ""
log "done."
