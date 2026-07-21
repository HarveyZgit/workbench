# Markdown Comment

`markdown-comment` is the Markdown-commenting capability in AI Workbench. It provides Markdown comment threads, a VS Code extension, the `markdown-comment` / `mdc` CLI, and an Agent Skill.

The migrated implementation keeps the existing VS Code rendered-preview workflow and global-storage compatibility. Its next refactoring phase will extract an editor-neutral core so CLI, Skills, VS Code, and future IDE or local-web adapters share one domain and storage contract.

Before changing this package, read the repository-root `AGENTS.md` and `docs/architecture/markdown-comment.md`.

## Development

From the repository root:

```sh
emo run check --filter './packages/markdown-comment'
emo run build --filter './packages/markdown-comment'
```
