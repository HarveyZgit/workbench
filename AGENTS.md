# AI Workbench Agent Guide

## Purpose

This repository is a personal Monorepo for AI assets: tools, Skills, rules, CLIs, MCP services, and their shared configuration. Keep every asset independently understandable, testable, and installable.

The repository is written primarily for a Chinese-speaking maintainer. User-facing documentation and product copy should normally be Chinese; use English when it is conventional for code, package metadata, or commit messages.

## Source of truth

- Read [README.md](README.md) for repository scope and development entry points.
- Read [docs/architecture/markdown-comment.md](docs/architecture/markdown-comment.md) before changing `packages/markdown-comment`.
- `packages/markdown-comment` contains the migrated VS Code implementation. It remains a legacy, VS Code-centred implementation while the editor-neutral core is extracted.
- Skill source files live in `resources/skills/<skill-name>/SKILL.md`. See [resources/skills/README.md](resources/skills/README.md) for the two skill types (pure workflow vs package-bound `{{ }}`), the host-neutrality rules, and explicit-target installation. `resources/skills` is the source of truth; platform-specific discovery or publishing files are thin adapters only.

## Markdown Comment design

`markdown-comment` is Markdown-commenting software first. Its pure domain layer owns documents, threads, comments, anchors, relocation, and storage contracts.

- CLI, VS Code, Skills, local web pages, and future IDE integrations are adapters.
- Core code must not import `vscode`, browser globals, or a particular editor SDK.
- Comment storage must not require VS Code to have started. Editor-specific storage is only a compatibility/import concern.
- Skills are operating instructions for an Agent; they must invoke the public CLI/API rather than reach into private storage formats.
- Preserve existing data when changing the stored schema. Make compatibility fields optional and provide explicit migrations where needed.

## Working rules

- This is an Eden Monorepo: use `emo`, never invoke `pnpm` directly. Use `emo run-pnpm` only when inspecting pnpm-specific behavior.
- Scope commands with `--filter` whenever possible, for example `emo run build --filter './packages/markdown-comment'`.
- Prefer `rg` for searches. Respect `.gitignore`; use `rg --no-ignore` only when ignored files are intentionally in scope.
- Do not edit the original tool repository under `~/Work/Code/corehr-fe-ai-kit` unless the task explicitly includes that repository. Its migration history and any untracked files belong to the user.
- Keep changes narrow. Do not replace unrelated user changes or generated files.
- Update the architecture document and relevant README when a public boundary, storage format, command, or adapter changes.
- Keep reusable AI assets host-neutral: do not hard-code an Agent/CLI/vendor identity, email, proprietary tool invocation, runtime directory, or default install target. Put platform-specific wiring only in clearly named adapter files and keep it removable without changing the source asset.

## Verification

Run the focused Agent-neutrality check when changing reusable AI assets,
installation/distribution paths, or host adapters:

```sh
python3 scripts/test-agent-neutrality.py
python3 scripts/check-agent-neutrality.py
```

Run the smallest relevant checks before handing off. For the current Markdown Comment package:

```sh
emo run build --filter './packages/markdown-comment'
emo run check --filter './packages/markdown-comment'
```

When the tool migration introduces new checks, document them in the package README and run the adapter-specific checks affected by the change.
