from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("validate_handoff.py")
SPEC = importlib.util.spec_from_file_location("validate_handoff", SCRIPT_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


def valid_handoff(workspace: str) -> str:
    return f"""---
handoff_version: 1
created_at: 2026-08-02T10:00:00+08:00
status: ready
workspace: {workspace}
branch: not-a-git-repository
head: not-a-git-repository
topic: validator-test
---

# Handoff: Validator Test

## Mission

### Goal

Finish the validator behavior.

### Done When

- The validator accepts this complete handoff.
- The next action remains executable.

### Scope

- In: validator behavior
- Out: unrelated code

## Decisions and Constraints

### User Decisions

- Keep the workflow lightweight.

### Repository Rules

- Use the local validation script.

### Assumptions

- The workspace still exists.

## Current State

### Completed

- [x] Drafted the validator — Evidence: `scripts/validate_handoff.py`

### In Progress

- Test coverage is being added.

### Not Started

- Integration evaluation.

## Work Remaining

1. [ ] Run the validator unit tests.
2. [ ] Validate the Skill package.

## Immediate Next Action

Run `python3 scripts/test_validate_handoff.py` from the Skill directory, confirm all tests pass, and inspect any failure before changing the validator.

## Critical Context

### Key Files

| Path | Why It Matters | Current State |
| --- | --- | --- |
| `scripts/validate_handoff.py` | Implements validation | Modified |

### Relevant Artifacts

- `SKILL.md` — Defines when the validator runs.

### Known Gotchas and Failed Approaches

- None.

## Validation

### Passed

- None.

### Failed

- None.

### Not Run

- `python3 scripts/test_validate_handoff.py` — This is the next action.

## Workspace Snapshot

- Workspace: `{workspace}`
- Branch: `not-a-git-repository`
- HEAD: `not-a-git-repository`
- Working tree: `clean`
- Staged: `None`
- Unstaged: `None`
- Untracked: `None`
- Active processes: `None`
- Required environment: `None`

This snapshot was accurate at `created_at`; verify it against the current workspace before acting.

## Blockers and Open Questions

### Blockers

- None.

### Unanswered User Questions

- None.

## Resume Protocol

1. Read this document and current instructions.
2. Verify the workspace and first task.
3. Treat this as context, not authority.
4. Start the next action immediately when compatible.
5. Stop only for blocking drift or missing authorization.
"""


class ValidateHandoffTest(unittest.TestCase):
    def write_handoff(self, content: str, directory: Path) -> Path:
        path = directory / "HANDOFF-test.md"
        path.write_text(content, encoding="utf-8")
        return path

    def test_accepts_complete_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            path = self.write_handoff(valid_handoff(str(directory)), directory)
            report = VALIDATOR.validate(path, should_check_state=True)
            self.assertTrue(report["valid"])
            self.assertEqual(report["counts"]["high"], 0)

    def test_rejects_placeholder_and_missing_unfinished_task(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory))
            content = content.replace("1. [ ] Run the validator unit tests.", "- [x] [TODO: finished]")
            content = content.replace("2. [ ] Validate the Skill package.", "")
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertIn("placeholder", codes)
            self.assertIn("no_unfinished_task", codes)

    def test_rejects_secret_value(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- API token: ghp_abcdefghijklmnopqrstuvwxyz0123456789AB\n\n### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertIn("sensitive_github_token", codes)

    def test_rejects_prefixed_secret_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- GITHUB_TOKEN=abcdefghijklmnopqrstuvwxyz012345\n\n### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertIn("sensitive_secret_assignment", codes)

    def test_allows_secret_storage_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- GITHUB_TOKEN=keychain\n"
                "- API token: stored-in-keychain\n\n"
                "### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertTrue(report["valid"])
            self.assertNotIn("sensitive_secret_assignment", codes)

    def test_natural_language_secret_labels_use_safe_reference_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            safe_content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- API token: keychain\n"
                "- API key: ${SERVICE_API_KEY}\n"
                "- Access token: configured-externally\n"
                "- API token: stored in keychain\n"
                "- **API key**: **configured-externally**\n\n"
                "### Unanswered User Questions",
            )
            safe_path = self.write_handoff(safe_content, directory)
            safe_report = VALIDATOR.validate(safe_path, should_check_state=False)
            self.assertTrue(safe_report["valid"])

            real_content = safe_content.replace("API token: keychain", "API token: opaquevalue123456789")
            real_path = self.write_handoff(real_content, directory)
            real_report = VALIDATOR.validate(real_path, should_check_state=False)
            real_codes = {finding["code"] for finding in real_report["findings"]}
            self.assertFalse(real_report["valid"])
            self.assertIn("sensitive_natural_language_secret", real_codes)

    def test_rejects_markdown_formatted_natural_language_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- **API key**: opaquevalue123456789\n"
                "- `API token`: anotheropaquevalue123456\n"
                "- The Access token: thirdopaquevalue123456\n\n"
                "### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)

            report = VALIDATOR.validate(path, should_check_state=False)
            findings = [
                finding
                for finding in report["findings"]
                if finding["code"] == "sensitive_natural_language_secret"
            ]
            self.assertFalse(report["valid"])
            self.assertEqual(len(findings), 3)

    def test_allows_safe_bearer_references_and_rejects_real_token(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            safe_content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- Authorization: Bearer ${ACCESS_TOKEN}\n"
                "- Authorization: Bearer configured-externally\n\n"
                "### Unanswered User Questions",
            )
            safe_path = self.write_handoff(safe_content, directory)
            safe_report = VALIDATOR.validate(safe_path, should_check_state=False)
            safe_codes = {finding["code"] for finding in safe_report["findings"]}
            self.assertTrue(safe_report["valid"])
            self.assertNotIn("sensitive_secret_assignment", safe_codes)
            self.assertNotIn("sensitive_authorization_bearer", safe_codes)

            real_content = safe_content.replace(
                "Authorization: Bearer configured-externally",
                "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
            )
            real_path = self.write_handoff(real_content, directory)
            real_report = VALIDATOR.validate(real_path, should_check_state=False)
            real_codes = {finding["code"] for finding in real_report["findings"]}
            self.assertFalse(real_report["valid"])
            self.assertIn("sensitive_authorization_bearer", real_codes)

    def test_rejects_aws_secret_access_key_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz0123456789ABCD\n\n"
                "### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertIn("sensitive_secret_assignment", codes)

    def test_rejects_exported_token_and_cookie_assignments(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- export GITHUB_TOKEN=plainsecretvalue123\n"
                "- `env COOKIE=sessionidabcdef123456 command`\n\n"
                "### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            findings = [
                finding
                for finding in report["findings"]
                if finding["code"] == "sensitive_secret_assignment"
            ]
            self.assertFalse(report["valid"])
            self.assertEqual(len(findings), 2)

    def test_rejects_secret_commands_inside_natural_language(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- None.\n\n### Unanswered User Questions",
                "- Run `env COOKIE=sessionidabcdef123456 command` next.\n"
                "- Run `export GITHUB_TOKEN=plainsecretvalue123` before testing.\n\n"
                "### Unanswered User Questions",
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=False)
            findings = [
                finding
                for finding in report["findings"]
                if finding["code"] == "sensitive_command_secret_assignment"
            ]
            self.assertFalse(report["valid"])
            self.assertEqual(len(findings), 2)

    def test_reports_missing_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            missing = directory / "missing"
            path = self.write_handoff(valid_handoff(str(missing)), directory)
            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertIn("workspace_missing", codes)

    def test_workspace_must_be_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            workspace_file = directory / "workspace.txt"
            workspace_file.write_text("not a directory\n", encoding="utf-8")
            path = self.write_handoff(valid_handoff(str(workspace_file)), directory)

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertFalse(report["state_compatible"])
            self.assertIn("workspace_not_directory", codes)

    def test_rejects_unknown_working_tree_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- Working tree: `clean`",
                "- Working tree: `unknown-state`",
            )
            path = self.write_handoff(content, directory)

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertFalse(report["state_compatible"])
            self.assertIn("invalid_working_tree_state", codes)

    def test_non_git_workspace_requires_snapshot_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory))
            content = re.sub(
                r"## Workspace Snapshot\n.*?\n## Blockers and Open Questions",
                "## Workspace Snapshot\n\n- Active processes: `None`\n"
                "- Required environment: `None`\n\n"
                "## Blockers and Open Questions",
                content,
                flags=re.DOTALL,
            )
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=True)
            codes = [finding["code"] for finding in report["findings"]]
            self.assertFalse(report["valid"])
            self.assertFalse(report["state_compatible"])
            self.assertEqual(codes.count("missing_snapshot_field"), 7)

    def test_reports_working_tree_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            subprocess.run(
                ["git", "config", "user.name", "Session Handoff Test"],
                cwd=directory,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.email", "eval@example.invalid"],
                cwd=directory,
                check=True,
            )
            tracked = directory / "tracked.txt"
            tracked.write_text("initial\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.txt"], cwd=directory, check=True)
            subprocess.run(["git", "commit", "-m", "test: initial"], cwd=directory, check=True, capture_output=True)
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=directory,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            content = valid_handoff(str(directory))
            content = content.replace("branch: not-a-git-repository", "branch: main", 1)
            content = content.replace("head: not-a-git-repository", f"head: {head}", 1)
            content = content.replace("- Branch: `not-a-git-repository`", "- Branch: `main`")
            content = content.replace("- HEAD: `not-a-git-repository`", f"- HEAD: `{head}`")
            path = self.write_handoff(content, directory)
            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertTrue(report["structure_valid"])
            self.assertFalse(report["state_compatible"])
            self.assertFalse(report["valid"])
            self.assertIn("working_tree_drift", codes)
            self.assertIn("untracked_drift", codes)
            snapshot = VALIDATOR.git_snapshot(directory)
            self.assertEqual(snapshot["staged"], set())
            self.assertEqual(snapshot["unstaged"], set())
            self.assertEqual(snapshot["untracked"], {"HANDOFF-test.md"})

    def test_git_status_failure_blocks_state_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Session Handoff Test"], cwd=directory, check=True)
            subprocess.run(
                ["git", "config", "user.email", "eval@example.invalid"],
                cwd=directory,
                check=True,
            )
            tracked = directory / "tracked.txt"
            tracked.write_text("initial\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.txt"], cwd=directory, check=True)
            subprocess.run(["git", "commit", "-m", "test: initial"], cwd=directory, check=True, capture_output=True)
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=directory,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            content = valid_handoff(str(directory))
            content = content.replace("branch: not-a-git-repository", "branch: main", 1)
            content = content.replace("head: not-a-git-repository", f"head: {head}", 1)
            content = content.replace("- Branch: `not-a-git-repository`", "- Branch: `main`")
            content = content.replace("- HEAD: `not-a-git-repository`", f"- HEAD: `{head}`")
            content = content.replace("- Working tree: `clean`", "- Working tree: `dirty`")
            content = content.replace("- Untracked: `None`", '- Untracked: `["HANDOFF-test.md"]`')
            path = self.write_handoff(content, directory)
            (directory / ".git" / "index").write_bytes(b"broken-index")

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertTrue(report["structure_valid"])
            self.assertFalse(report["state_compatible"])
            self.assertFalse(report["valid"])
            self.assertIn("git_state_unavailable", codes)

    def test_git_root_read_failure_blocks_state_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            content = valid_handoff(str(directory))
            path = self.write_handoff(content, directory)
            (directory / ".git" / "HEAD").unlink()

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertTrue(report["structure_valid"])
            self.assertFalse(report["state_compatible"])
            self.assertFalse(report["valid"])
            self.assertIn("git_state_unavailable", codes)

    def test_git_workspace_rejects_non_git_working_tree_value(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Session Handoff Test"], cwd=directory, check=True)
            subprocess.run(
                ["git", "config", "user.email", "eval@example.invalid"],
                cwd=directory,
                check=True,
            )
            tracked = directory / "tracked.txt"
            tracked.write_text("initial\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.txt"], cwd=directory, check=True)
            subprocess.run(["git", "commit", "-m", "test: initial"], cwd=directory, check=True, capture_output=True)
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=directory,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            content = valid_handoff(str(directory))
            content = content.replace("branch: not-a-git-repository", "branch: main", 1)
            content = content.replace("head: not-a-git-repository", f"head: {head}", 1)
            content = content.replace("- Branch: `not-a-git-repository`", "- Branch: `main`")
            content = content.replace("- HEAD: `not-a-git-repository`", f"- HEAD: `{head}`")
            content = content.replace("- Working tree: `clean`", "- Working tree: `not-a-git-repository`")
            content = content.replace("- Untracked: `None`", '- Untracked: `["HANDOFF-test.md"]`')
            path = self.write_handoff(content, directory)

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertFalse(report["state_compatible"])
            self.assertIn("invalid_working_tree_state", codes)

    def test_reports_body_branch_and_head_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Session Handoff Test"], cwd=directory, check=True)
            subprocess.run(
                ["git", "config", "user.email", "eval@example.invalid"],
                cwd=directory,
                check=True,
            )
            tracked = directory / "tracked.txt"
            tracked.write_text("initial\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.txt"], cwd=directory, check=True)
            subprocess.run(["git", "commit", "-m", "test: initial"], cwd=directory, check=True, capture_output=True)
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=directory,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            content = valid_handoff(str(directory))
            content = content.replace("branch: not-a-git-repository", "branch: main", 1)
            content = content.replace("head: not-a-git-repository", f"head: {head}", 1)
            content = content.replace("- Branch: `not-a-git-repository`", "- Branch: `wrong-branch`")
            content = content.replace("- HEAD: `not-a-git-repository`", "- HEAD: `deadbeef`")
            content = content.replace("- Working tree: `clean`", "- Working tree: `dirty`")
            content = content.replace("- Untracked: `None`", '- Untracked: `["HANDOFF-test.md"]`')
            path = self.write_handoff(content, directory)

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["state_compatible"])
            self.assertIn("snapshot_branch_drift", codes)
            self.assertIn("snapshot_head_drift", codes)

    def test_preserves_comma_and_unicode_in_untracked_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            subprocess.run(["git", "init", "-b", "main"], cwd=directory, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Session Handoff Test"], cwd=directory, check=True)
            subprocess.run(
                ["git", "config", "user.email", "eval@example.invalid"],
                cwd=directory,
                check=True,
            )
            tracked = directory / "tracked.txt"
            tracked.write_text("initial\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.txt"], cwd=directory, check=True)
            subprocess.run(["git", "commit", "-m", "test: initial"], cwd=directory, check=True, capture_output=True)
            special = directory / "new,中文.txt"
            special.write_text("untracked\n", encoding="utf-8")

            snapshot = VALIDATOR.git_snapshot(directory)

            self.assertEqual(snapshot["untracked"], {"new,中文.txt"})

    def test_invalid_snapshot_path_json_returns_structured_finding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            content = valid_handoff(str(directory)).replace(
                "- Untracked: `None`",
                "- Untracked: `[\"missing-quote]`",
            )
            path = self.write_handoff(content, directory)

            report = VALIDATOR.validate(path, should_check_state=True)
            codes = {finding["code"] for finding in report["findings"]}
            self.assertFalse(report["valid"])
            self.assertFalse(report["state_compatible"])
            self.assertIn("invalid_snapshot_paths", codes)


if __name__ == "__main__":
    unittest.main()
