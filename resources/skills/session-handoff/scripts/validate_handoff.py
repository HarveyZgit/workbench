#!/usr/bin/env python3
"""Validate a session handoff's structure, redaction, and workspace snapshot."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


REQUIRED_SECTIONS = (
    "Mission",
    "Decisions and Constraints",
    "Current State",
    "Work Remaining",
    "Immediate Next Action",
    "Critical Context",
    "Validation",
    "Workspace Snapshot",
    "Blockers and Open Questions",
    "Resume Protocol",
)

REQUIRED_FRONTMATTER = (
    "handoff_version",
    "created_at",
    "status",
    "workspace",
    "branch",
    "head",
    "topic",
)

PLACEHOLDER_PATTERNS = (
    re.compile(r"\[TODO(?::[^\]]*)?\]", re.IGNORECASE),
    re.compile(r"\[(?:ISO-8601|absolute repository|branch name|full commit|short kebab|concise task)", re.IGNORECASE),
    re.compile(r"\[(?:the outcome|observable completion|required validation|included work|explicitly excluded)", re.IGNORECASE),
    re.compile(r"\[(?:decision or correction|applicable AGENTS|assumption that|completed result|what is partially)", re.IGNORECASE),
    re.compile(r"\[(?:work not yet|first executable|second task|later task|write one concrete)", re.IGNORECASE),
    re.compile(r"\[(?:relative or absolute|role in the task|modified / generated|plan, design|non-obvious behavior)", re.IGNORECASE),
    re.compile(r"\[(?:exact command|result|failure and whether|command or check|why it remains)", re.IGNORECASE),
    re.compile(r"\[(?:paths or None|relevant process|required environment|blocker, owner|question asked)", re.IGNORECASE),
)

SECRET_PATTERNS = (
    ("private_key", "high", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("github_token", "high", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("openai_or_anthropic_key", "high", re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b")),
    ("slack_token", "high", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("jwt", "high", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    (
        "secret_assignment",
        "high",
        re.compile(
            r"(?im)^[ \t]*(?:[-*]\s+)?`?"
            r"(?:(?:export|env)\s+)?"
            r"(?P<variable>(?:[A-Za-z][A-Za-z0-9_]*_)?"
            r"(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET|"
            r"COOKIE|SESSION(?:_ID|_COOKIE)?|AUTH(?:ORIZATION|_TOKEN)?))"
            r"`?[ \t]*[:=][ \t]*[\"']?(?P<value>[^\s\"'<>`]{6,})"
        ),
    ),
    (
        "command_secret_assignment",
        "high",
        re.compile(
            r"(?i)(?:export|env)\s+"
            r"(?P<variable>(?:[A-Za-z][A-Za-z0-9_]*_)?"
            r"(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET|"
            r"COOKIE|SESSION(?:_ID|_COOKIE)?|AUTH(?:ORIZATION|_TOKEN)?))"
            r"[ \t]*=[ \t]*[\"']?(?P<value>[^\s\"'<>`]{6,})"
        ),
    ),
    (
        "natural_language_secret",
        "high",
        re.compile(
            r"(?im)^[^\n:]{0,80}?"
            r"(?:\*\*|__|`)?"
            r"(?P<variable>API[ _-]?(?:KEY|TOKEN)|ACCESS[ _-]?TOKEN|"
            r"CLIENT[ _-]?SECRET|PASSWORD|SESSION[ _-]?(?:ID|COOKIE)|COOKIE)"
            r"(?:\*\*|__|`)?"
            r"[ \t]*:[ \t]*(?P<value>[^\n]+)"
        ),
    ),
    (
        "authorization_bearer",
        "high",
        re.compile(
            r"(?i)\bAuthorization\s*[:=]\s*Bearer\s+"
            r"(?P<value>\$+\{?[A-Z][A-Z0-9_]*\}?|[^\s`\"'<>]+)"
        ),
    ),
    (
        "credentialed_url",
        "high",
        re.compile(r"\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s/:]+:[^@\s]+@[^\s]+"),
    ),
    (
        "url_token_parameter",
        "high",
        re.compile(r"https?://[^\s<>]*(?:[?&](?:token|access_token|api_key|key)=)[^\s<>&]+", re.IGNORECASE),
    ),
    ("email_address", "medium", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
)

SAFE_SECRET_REFERENCE = re.compile(
    r"(?ix)^(?:"
    r"\$+\{?[A-Z][A-Z0-9_]*\}?|"
    r"\[?REDACTED\]?|<REDACTED>|"
    r"(?:stored[-_ ]in[-_ ])?(?:keychain|secret[-_ ]manager|1password|vault)|"
    r"configured[-_ ]externally|not[-_ ]set|unset"
    r")$"
)


def normalize_secret_reference(value: str) -> str:
    normalized = value.strip().rstrip(".,;")
    normalized = normalized.strip("\"'")
    for wrapper in ("**", "__", "`"):
        if normalized.startswith(wrapper) and normalized.endswith(wrapper) and len(normalized) > len(wrapper) * 2:
            normalized = normalized[len(wrapper) : -len(wrapper)].strip()
    return normalized

STATE_FINDING_CODES = {
    "workspace_missing",
    "workspace_not_directory",
    "git_state_mismatch",
    "workspace_root_differs",
    "branch_drift",
    "head_drift",
    "snapshot_branch_drift",
    "snapshot_head_drift",
    "working_tree_drift",
    "staged_drift",
    "unstaged_drift",
    "untracked_drift",
    "missing_snapshot_field",
    "invalid_snapshot_paths",
    "git_state_unavailable",
    "invalid_working_tree_state",
}


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    line: int | None = None


class GitStateReadError(RuntimeError):
    pass


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    closing = text.find("\n---\n", 4)
    if closing < 0:
        return {}, text

    metadata: dict[str, str] = {}
    for raw_line in text[4:closing].splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#") or ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")
    return metadata, text[closing + 5 :]


def split_sections(body: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current: str | None = None
    lines: list[str] = []
    for line in body.splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            if current is not None:
                sections[current] = "\n".join(lines).strip()
            current = match.group(1).strip()
            lines = []
        elif current is not None:
            lines.append(line)
    if current is not None:
        sections[current] = "\n".join(lines).strip()
    return sections


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def run_git(workspace: Path, *args: str) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return 1, "", str(error)
    return result.returncode, result.stdout.rstrip("\n"), result.stderr.rstrip("\n")


def has_git_marker(workspace: Path) -> bool:
    for directory in (workspace, *workspace.parents):
        marker = directory / ".git"
        if marker.exists() or marker.is_symlink():
            return True
    return False


def git_snapshot(workspace: Path) -> dict[str, object] | None:
    code, root, root_error = run_git(workspace, "rev-parse", "--show-toplevel")
    if code != 0:
        if "not a git repository" in root_error.casefold() and not has_git_marker(workspace):
            return None
        raise GitStateReadError(f"git rev-parse --show-toplevel failed: {root_error or 'unknown error'}")

    branch_code, branch, branch_error = run_git(workspace, "branch", "--show-current")
    if branch_code != 0:
        raise GitStateReadError(f"git branch --show-current failed: {branch_error or 'unknown error'}")
    head_code, head, head_error = run_git(workspace, "rev-parse", "HEAD")
    if head_code != 0:
        raise GitStateReadError(f"git rev-parse HEAD failed: {head_error or 'unknown error'}")
    status_code, porcelain, status_error = run_git(
        workspace,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
    )
    if status_code != 0:
        raise GitStateReadError(f"git status --porcelain failed: {status_error or 'unknown error'}")
    staged: set[str] = set()
    unstaged: set[str] = set()
    untracked: set[str] = set()
    entries = porcelain.split("\0")
    entry_index = 0
    while entry_index < len(entries):
        entry = entries[entry_index]
        entry_index += 1
        if len(entry) < 3:
            continue
        index_status, worktree_status = entry[0], entry[1]
        file_path = entry[3:]
        if index_status == "?" and worktree_status == "?":
            untracked.add(file_path)
            continue
        if index_status not in {" ", "?"}:
            staged.add(file_path)
        if worktree_status not in {" ", "?"}:
            unstaged.add(file_path)
        if index_status in {"R", "C"} or worktree_status in {"R", "C"}:
            entry_index += 1
    return {
        "workspace": str(Path(root).resolve()),
        "branch": branch or "detached",
        "head": head,
        "dirty": bool(porcelain),
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
    }


def parse_snapshot_fields(body: str) -> dict[str, str]:
    workspace_snapshot = split_sections(body).get("Workspace Snapshot", "")
    fields: dict[str, str] = {}
    for field in ("Workspace", "Branch", "HEAD", "Working tree", "Staged", "Unstaged", "Untracked"):
        match = re.search(
            rf"^-\s+{re.escape(field)}:\s+`?(.+?)`?\s*$",
            workspace_snapshot,
            re.MULTILINE,
        )
        if match:
            fields[field] = match.group(1).strip().strip("`")
    return fields


def parse_path_set(value: str) -> set[str]:
    if not value or value.casefold() == "none":
        return set()
    if value.startswith("["):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("Workspace Snapshot path fields must be JSON arrays of strings.")
        return set(parsed)
    return {value.strip().strip("`")}


def check_structure(text: str, metadata: dict[str, str], body: str) -> list[Finding]:
    findings: list[Finding] = []

    if not metadata:
        findings.append(Finding("high", "missing_frontmatter", "Missing or malformed YAML frontmatter."))
    else:
        for key in REQUIRED_FRONTMATTER:
            value = metadata.get(key, "")
            if not value:
                findings.append(Finding("high", "missing_metadata", f"Missing frontmatter field: {key}."))

    sections = split_sections(body)
    for section in REQUIRED_SECTIONS:
        content = sections.get(section)
        if content is None:
            findings.append(Finding("high", "missing_section", f"Missing section: ## {section}."))
        elif not content.strip():
            findings.append(Finding("high", "empty_section", f"Section is empty: ## {section}."))

    remaining = sections.get("Work Remaining", "")
    if remaining and not re.search(r"^\s*\d+\.\s+\[ \]\s+\S", remaining, re.MULTILINE):
        findings.append(
            Finding(
                "high",
                "no_unfinished_task",
                "Work Remaining must contain at least one numbered unchecked task.",
            )
        )

    immediate = sections.get("Immediate Next Action", "")
    if immediate and len(immediate) < 80:
        findings.append(
            Finding(
                "medium",
                "thin_next_action",
                "Immediate Next Action is too short to specify action, starting point, expected result, and verification.",
            )
        )

    done_when = re.search(r"^###\s+Done When\s*$", sections.get("Mission", ""), re.MULTILINE)
    if not done_when:
        findings.append(Finding("high", "missing_done_when", "Mission must include a '### Done When' subsection."))

    for pattern in PLACEHOLDER_PATTERNS:
        for match in pattern.finditer(text):
            findings.append(
                Finding(
                    "high",
                    "placeholder",
                    f"Unresolved template placeholder: {match.group(0)[:80]}",
                    line_number(text, match.start()),
                )
            )

    return findings


def check_secrets(text: str) -> list[Finding]:
    findings: list[Finding] = []
    for name, severity, pattern in SECRET_PATTERNS:
        for match in pattern.finditer(text):
            matched = match.group(0)
            if matched == "TRAE CLI <noreply@bytedance.com>":
                continue
            if name in {"secret_assignment", "command_secret_assignment", "natural_language_secret"}:
                variable = match.groupdict().get("variable", "").casefold()
                value = normalize_secret_reference(match.groupdict().get("value", ""))
                if variable == "authorization" and value.casefold() == "bearer":
                    continue
                if SAFE_SECRET_REFERENCE.fullmatch(value):
                    continue
            if name == "authorization_bearer":
                value = normalize_secret_reference(match.groupdict().get("value", ""))
                if SAFE_SECRET_REFERENCE.fullmatch(value):
                    continue
            findings.append(
                Finding(
                    severity,
                    f"sensitive_{name}",
                    f"Potential sensitive value detected ({name}); redact the value or reference its storage mechanism.",
                    line_number(text, match.start()),
                )
            )
    return findings


def check_state(metadata: dict[str, str], body: str, handoff_path: Path) -> list[Finding]:
    findings: list[Finding] = []
    workspace_value = metadata.get("workspace", "")
    if not workspace_value:
        return findings

    workspace = Path(workspace_value).expanduser()
    if not workspace.exists():
        return [
            Finding(
                "high",
                "workspace_missing",
                f"Recorded workspace does not exist: {workspace}.",
            )
        ]
    if not workspace.is_dir():
        return [
            Finding(
                "high",
                "workspace_not_directory",
                f"Recorded workspace is not a directory: {workspace}.",
            )
        ]

    try:
        snapshot = git_snapshot(workspace)
    except GitStateReadError as error:
        return [
            Finding(
                "high",
                "git_state_unavailable",
                f"Unable to read current Git state safely: {error}.",
            )
        ]
    recorded_snapshot = parse_snapshot_fields(body)
    recorded_branch = metadata.get("branch", "")
    recorded_head = metadata.get("head", "")

    for field in ("Workspace", "Branch", "HEAD", "Working tree", "Staged", "Unstaged", "Untracked"):
        if field not in recorded_snapshot:
            findings.append(
                Finding(
                    "high",
                    "missing_snapshot_field",
                    f"Workspace Snapshot is missing field: {field}.",
                )
            )

    recorded_path_sets: dict[str, set[str]] = {}
    for field in ("Staged", "Unstaged", "Untracked"):
        if field not in recorded_snapshot:
            continue
        try:
            recorded_path_sets[field] = parse_path_set(recorded_snapshot[field])
        except (json.JSONDecodeError, ValueError) as error:
            findings.append(
                Finding(
                    "high",
                    "invalid_snapshot_paths",
                    f"{field} must be None, one path, or a JSON array of strings: {error}.",
                )
            )

    recorded_working_tree = recorded_snapshot.get("Working tree")
    allowed_working_tree = {"clean", "dirty", "not-a-git-repository"}
    if recorded_working_tree is not None and recorded_working_tree.casefold() not in allowed_working_tree:
        findings.append(
            Finding(
                "high",
                "invalid_working_tree_state",
                "Working tree must be one of: clean, dirty, not-a-git-repository.",
            )
        )

    if snapshot is None:
        if recorded_branch != "not-a-git-repository" or recorded_head != "not-a-git-repository":
            findings.append(
                Finding(
                    "high",
                    "git_state_mismatch",
                    "Recorded metadata expects a Git repository, but the workspace is not currently a Git repository.",
                )
            )
        recorded_workspace = recorded_snapshot.get("Workspace")
        if recorded_workspace and str(Path(recorded_workspace).expanduser().resolve()) != str(workspace.resolve()):
            findings.append(
                Finding(
                    "medium",
                    "workspace_root_differs",
                    f"Workspace Snapshot records '{recorded_workspace}', current workspace is '{workspace.resolve()}'.",
                )
            )
        if recorded_snapshot.get("Branch") not in {None, "not-a-git-repository"}:
            findings.append(
                Finding(
                    "medium",
                    "snapshot_branch_drift",
                    "Non-Git workspace must record Branch as 'not-a-git-repository'.",
                )
            )
        if recorded_snapshot.get("HEAD") not in {None, "not-a-git-repository"}:
            findings.append(
                Finding(
                    "medium",
                    "snapshot_head_drift",
                    "Non-Git workspace must record HEAD as 'not-a-git-repository'.",
                )
            )
        if recorded_working_tree not in {None, "clean", "not-a-git-repository"}:
            findings.append(
                Finding(
                    "medium",
                    "working_tree_drift",
                    "Non-Git workspace must record Working tree as 'clean' or 'not-a-git-repository'.",
                )
            )
        for field, paths in recorded_path_sets.items():
            if paths:
                findings.append(
                    Finding(
                        "medium",
                        f"{field.casefold()}_drift",
                        f"Non-Git workspace must record {field} as None.",
                    )
                )
        return findings

    if snapshot["workspace"] != str(workspace.resolve()):
        findings.append(
            Finding(
                "medium",
                "workspace_root_differs",
                f"Recorded workspace resolves to {workspace.resolve()}, Git root is {snapshot['workspace']}.",
            )
        )
    if recorded_working_tree == "not-a-git-repository":
        findings.append(
            Finding(
                "high",
                "invalid_working_tree_state",
                "Git workspace must record Working tree as clean or dirty.",
            )
        )
    recorded_workspace = recorded_snapshot.get("Workspace")
    if recorded_workspace and str(Path(recorded_workspace).expanduser().resolve()) != snapshot["workspace"]:
        findings.append(
            Finding(
                "medium",
                "workspace_root_differs",
                f"Workspace Snapshot records '{recorded_workspace}', current Git root is '{snapshot['workspace']}'.",
            )
        )
    if recorded_branch and recorded_branch != snapshot["branch"]:
        findings.append(
            Finding(
                "medium",
                "branch_drift",
                f"Branch changed: recorded '{recorded_branch}', current '{snapshot['branch']}'.",
            )
        )
    snapshot_branch = recorded_snapshot.get("Branch")
    if snapshot_branch and snapshot_branch != snapshot["branch"]:
        findings.append(
            Finding(
                "medium",
                "snapshot_branch_drift",
                f"Workspace Snapshot branch changed: recorded '{snapshot_branch}', current '{snapshot['branch']}'.",
            )
        )
    if recorded_head and recorded_head != snapshot["head"]:
        findings.append(
            Finding(
                "medium",
                "head_drift",
                f"HEAD changed: recorded '{recorded_head}', current '{snapshot['head']}'.",
            )
        )
    snapshot_head = recorded_snapshot.get("HEAD")
    if snapshot_head and snapshot_head != snapshot["head"]:
        findings.append(
            Finding(
                "medium",
                "snapshot_head_drift",
                f"Workspace Snapshot HEAD changed: recorded '{snapshot_head}', current '{snapshot['head']}'.",
            )
        )

    recorded_dirty = recorded_snapshot.get("Working tree", "").casefold() == "dirty"
    if (
        "Working tree" in recorded_snapshot
        and recorded_snapshot["Working tree"].casefold() in {"clean", "dirty"}
        and recorded_dirty != snapshot["dirty"]
    ):
        findings.append(
            Finding(
                "medium",
                "working_tree_drift",
                f"Working tree changed: recorded '{recorded_snapshot['Working tree']}', "
                f"current '{'dirty' if snapshot['dirty'] else 'clean'}'.",
            )
        )

    for field, key, code in (
        ("Staged", "staged", "staged_drift"),
        ("Unstaged", "unstaged", "unstaged_drift"),
        ("Untracked", "untracked", "untracked_drift"),
    ):
        if field not in recorded_path_sets:
            continue
        recorded_paths = recorded_path_sets[field]
        current_paths = snapshot[key]
        if recorded_paths != current_paths:
            findings.append(
                Finding(
                    "medium",
                    code,
                    f"{field} paths changed: recorded {sorted(recorded_paths)}, current {sorted(current_paths)}.",
                )
            )

    if handoff_path.resolve().is_relative_to(workspace.resolve()):
        relative = handoff_path.resolve().relative_to(workspace.resolve())
        if relative.parts and relative.parts[0] != ".tmp":
            findings.append(
                Finding(
                    "low",
                    "nondefault_location",
                    "Handoff is inside the workspace but outside .tmp; this is valid only when explicitly chosen.",
                )
            )

    return findings


def validate(path: Path, should_check_state: bool) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(text)
    findings = check_structure(text, metadata, body)
    findings.extend(check_secrets(text))
    structure_valid = not any(finding.severity == "high" for finding in findings)
    if should_check_state:
        findings.extend(check_state(metadata, body, path))

    severity_counts = {
        severity: sum(1 for finding in findings if finding.severity == severity)
        for severity in ("high", "medium", "low")
    }
    state_compatible = not any(finding.code in STATE_FINDING_CODES for finding in findings)
    valid = structure_valid and (not should_check_state or state_compatible)
    return {
        "file": str(path),
        "valid": valid,
        "structure_valid": structure_valid,
        "state_compatible": state_compatible if should_check_state else None,
        "state_checked": should_check_state,
        "metadata": metadata,
        "counts": severity_counts,
        "findings": [asdict(finding) for finding in findings],
    }


def print_human(report: dict[str, object]) -> None:
    verdict = "PASS" if report["valid"] else "FAIL"
    print(f"{verdict}: {report['file']}")
    counts = report["counts"]
    print(f"Findings: high={counts['high']} medium={counts['medium']} low={counts['low']}")
    for finding in report["findings"]:
        location = f" line {finding['line']}" if finding["line"] else ""
        print(f"- [{finding['severity']}] {finding['code']}{location}: {finding['message']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handoff", type=Path, help="Handoff Markdown file to validate.")
    parser.add_argument(
        "--check-state",
        action="store_true",
        help="Compare recorded workspace, branch, and HEAD with the current Git state.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    args = parser.parse_args()

    if not args.handoff.is_file():
        print(f"Handoff file not found: {args.handoff}", file=sys.stderr)
        return 2

    try:
        report = validate(args.handoff, args.check_state)
    except (OSError, UnicodeError) as error:
        print(f"Unable to read handoff: {error}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
