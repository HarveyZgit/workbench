# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, the `markdown-comment` / `mdc` CLI, and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Its next refactoring phase will extract an editor-neutral core so CLI, Skills, VS Code, and future IDE or local-web adapters share one domain and storage contract.

The Skill source is kept at repository-root `resources/skills/markdown-comment/SKILL.md`. The build copies it into `dist/resources/` so `mdc init` and the packaged VSIX remain self-contained.

Before changing this package, read the repository-root `AGENTS.md` and `docs/architecture/markdown-comment.md`.

## Install

`mdc init` does not assume a particular Agent host or skill directory. Pass the target explicitly:

```sh
mdc init --skill-dir <full-skill-directory>
mdc init --skill-dirs <skill-root-a,skill-root-b>
```

`--skill-dir` points to the final `markdown-comment` directory. Each entry in
`--skill-dirs` is a skill root; the command creates a `markdown-comment`
subdirectory under it. Interactive use prompts for these roots, while
non-interactive use must provide one of the flags or use `--no-skill`.

The package `setup` script forwards arguments to `mdc init`. From the repository
root, pass the target explicitly in non-interactive environments:

```sh
emo run setup --filter './packages/markdown-comment' -- --skill-dir <full-skill-directory>
```

## Development

From the repository root:

```sh
emo run check --filter './packages/markdown-comment'
emo run build --filter './packages/markdown-comment'
```
