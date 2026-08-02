from __future__ import annotations

import subprocess
import tempfile
import unittest
import os
from pathlib import Path


SCRIPT = Path(__file__).with_name("setup_eval_workspace.py")


class SetupEvalWorkspaceTest(unittest.TestCase):
    def run_setup(
        self,
        *arguments: str,
        environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), *arguments],
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )

    def test_refuses_existing_unmanaged_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "existing"
            target.mkdir()
            sentinel = target / "keep.txt"
            sentinel.write_text("keep\n", encoding="utf-8")

            result = self.run_setup("create", str(target), "--replace")

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(sentinel.is_file())

    def test_refuses_existing_managed_directory_without_replace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "managed"
            first = self.run_setup("create", str(target))
            self.assertEqual(first.returncode, 0, first.stderr)

            second = self.run_setup("create", str(target))

            self.assertNotEqual(second.returncode, 0)
            self.assertTrue((target / ".session-handoff-eval").is_file())

    def test_replaces_only_managed_directory_with_explicit_flag(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "managed"
            first = self.run_setup("create", str(target))
            self.assertEqual(first.returncode, 0, first.stderr)
            extra = target / "replace-me.txt"
            extra.write_text("old\n", encoding="utf-8")

            second = self.run_setup("resume-compatible", str(target), "--replace")

            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertFalse(extra.exists())
            self.assertTrue((target / "HANDOFF-export-retry.md").is_file())

    def test_refuses_symlink_target_without_touching_real_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            real_target = root / "real"
            first = self.run_setup("create", str(real_target))
            self.assertEqual(first.returncode, 0, first.stderr)
            sentinel = real_target / "keep.txt"
            sentinel.write_text("keep\n", encoding="utf-8")
            link_target = root / "linked"
            link_target.symlink_to(real_target, target_is_directory=True)

            result = self.run_setup("resume-compatible", str(link_target), "--replace")

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(sentinel.is_file())
            self.assertTrue(link_target.is_symlink())

    def test_refuses_target_under_symlink_parent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            real_parent = root / "real-parent"
            real_parent.mkdir()
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(real_parent, target_is_directory=True)
            target = linked_parent / "child"

            result = self.run_setup("create", str(target))

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((real_parent / "child").exists())

    def test_refuses_parent_traversal_outside_temp_root(self) -> None:
        target = Path("/tmp/../../Users/bytedance/session-handoff-escape")

        result = self.run_setup("create", str(target))

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(Path("/Users/bytedance/session-handoff-escape").exists())

    def test_ignores_failing_global_hook_and_excludes_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            target = root / "workspace"
            hooks = root / "hooks"
            hooks.mkdir()
            pre_commit = hooks / "pre-commit"
            pre_commit.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            pre_commit.chmod(0o755)
            excludes = root / "global-ignore"
            excludes.write_text("AGENTS.md\nsrc/retry.ts\n", encoding="utf-8")
            git_config = root / "global.gitconfig"
            subprocess.run(
                ["git", "config", "-f", str(git_config), "core.hooksPath", str(hooks)],
                check=True,
            )
            subprocess.run(
                ["git", "config", "-f", str(git_config), "core.excludesFile", str(excludes)],
                check=True,
            )
            environment = os.environ.copy()
            environment["GIT_CONFIG_GLOBAL"] = str(git_config)

            result = self.run_setup("resume-compatible", str(target), environment=environment)

            self.assertEqual(result.returncode, 0, result.stderr)
            tracked = subprocess.run(
                ["git", "-C", str(target), "ls-files"],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            ).stdout.splitlines()
            self.assertIn("AGENTS.md", tracked)
            self.assertIn("src/retry.ts", tracked)
            status = subprocess.run(
                ["git", "-C", str(target), "status", "--porcelain=v1", "--untracked-files=all"],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            ).stdout
            self.assertIn("HANDOFF-export-retry.md", status)
            local_hooks = subprocess.run(
                ["git", "-C", str(target), "config", "--local", "--get", "core.hooksPath"],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            ).stdout.strip()
            local_excludes = subprocess.run(
                ["git", "-C", str(target), "config", "--local", "--get", "core.excludesFile"],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            ).stdout.strip()
            self.assertEqual(local_hooks, "/dev/null")
            self.assertEqual(local_excludes, "/dev/null")


if __name__ == "__main__":
    unittest.main()
