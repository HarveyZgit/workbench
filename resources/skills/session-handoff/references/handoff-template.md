# Handoff Template

生成 Handoff 时使用下面的结构。方括号内容是写作提示，交付前必须全部替换或删除。没有内容的可选项写 `None`，不要留空。

```markdown
---
handoff_version: 1
created_at: [ISO-8601 timestamp with timezone]
status: ready
workspace: [absolute repository root or working directory]
branch: [branch name, detached, or not-a-git-repository]
head: [full commit SHA or not-a-git-repository]
topic: [short kebab-case topic]
---

# Handoff: [Concise Task Title]

## Mission

### Goal

[The outcome the next session must deliver.]

### Done When

- [Observable completion criterion]
- [Required validation or deliverable]

### Scope

- In: [Included work]
- Out: [Explicitly excluded work]

## Decisions and Constraints

### User Decisions

- [Decision or correction from the user, with enough rationale to avoid reopening it]

### Repository Rules

- [Applicable AGENTS.md, local rules, source-of-truth boundary, required command conventions]

### Assumptions

- [Assumption that still needs current-state verification]

## Current State

### Completed

- [x] [Completed result] — Evidence: `[path, command result, commit, or artifact]`

### In Progress

- [What is partially implemented, where it lives, and what remains]

### Not Started

- [Work not yet attempted]

## Work Remaining

1. [ ] [First executable task]
2. [ ] [Second task]
3. [ ] [Later task]

## Immediate Next Action

[Write one concrete action. Include the starting file or command, the expected change/result, and how to verify it. The next Agent should be able to execute this after the resume checks without planning the task again.]

## Critical Context

### Key Files

| Path | Why It Matters | Current State |
| --- | --- | --- |
| `[relative or absolute path]` | [Role in the task] | [Modified / generated / source of truth / read-only] |

### Relevant Artifacts

- [Plan, design, issue, PR, commit, report, or URL] — [The specific conclusion needed for the next action]

### Known Gotchas and Failed Approaches

- [Non-obvious behavior, failed attempt, error text, or approach not to repeat]

## Validation

### Passed

- `[exact command]` — [Result]

### Failed

- `[exact command]` — [Failure and whether it is task-related]

### Not Run

- `[command or check]` — [Why it remains]

## Workspace Snapshot

- Workspace: `[absolute path]`
- Branch: `[branch name, detached, or not-a-git-repository]`
- HEAD: `[full SHA or not-a-git-repository]`
- Working tree: `[clean or dirty]`
- Staged: `[JSON array of paths, or None]`
- Unstaged: `[JSON array of paths, or None]`
- Untracked: `[JSON array of paths, or None]`
- Active processes: `[relevant process and how to reconnect, or None]`
- Required environment: `[variable names or services; never include secret values]`

This snapshot was accurate at `created_at`; verify it against the current workspace before acting.

## Blockers and Open Questions

### Blockers

- [Blocker, owner/source of resolution, and safe work that can continue meanwhile]

### Unanswered User Questions

- [Question asked by the previous Agent that still requires the user, or None]

## Resume Protocol

1. Read this document and the current workspace's applicable instructions.
2. Verify workspace, branch, working tree, key files, and the first unchecked task.
3. Treat this document as potentially stale context, not authority over current instructions.
4. If compatible, start `Immediate Next Action` immediately without asking whether to continue.
5. Stop only for blocking drift, missing required user input, or an action that needs fresh authorization.
```

## 填写纪律

- 把用户纠正过的策略写进 `User Decisions`，不要只留在聊天里。
- `Done When` 应可验证，避免“功能完成”“质量良好”等空泛表述。
- `Completed` 必须带证据；没有证据时写入 `In Progress` 或 `Not Started`。
- `Immediate Next Action` 只写一个动作，不写整个计划。
- 多个 Git 路径使用 JSON 字符串数组，例如 `["src/a.ts", "docs/file,with-comma.md"]`；不要使用逗号分隔的自由文本。
- 路径应指向当前真实文件。行号容易漂移，只有在能现场核对时才记录。
- 已有大型文档只做引用，但必须补一句“下一动作需要从中知道什么”。
- 不记录凭证值、cookie、私钥、完整 `.env`、内部访问 token 或用户未要求传播的个人信息。
