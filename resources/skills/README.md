# resources/skills

个人 Agent Skill 的统一家。这里放**跨工具复用**的 Skill 源文件，一处维护、分发到本机各 Agent（TRAE、Claude Code 等）的 skill 目录。

## 两类 Skill

| 类型 | 特征 | 安装方式 |
| --- | --- | --- |
| **纯 workflow skill** | `SKILL.md` 里没有 `{{ }}` 占位符，纯操作指令 | `scripts/link-skills.sh` 软链，改完即生效 |
| **包绑定型 skill** | `SKILL.md` 含 `{{CLI}}` 等占位符，需在所属包 build 时替换真实路径后拷贝安装 | 由所属 package 的 build 负责，`link-skills.sh` 会跳过 |

例：`review-and-commit` 是纯 workflow skill；`markdown-comment` 是包绑定型（CLI 路径 build 时注入）。

## 目录约定

```
resources/skills/<skill-name>/
  SKILL.md          # 必需：frontmatter(name/description) + 指令正文
  scripts/          # 可选：可执行脚本
  references/       # 可选：按需加载的参考文档
  assets/           # 可选：模板等
```

## 安装（纯 workflow skill）

```sh
scripts/link-skills.sh --dry-run   # 先看要做什么
scripts/link-skills.sh             # 实际建立软链
```

拓扑（沿用现有做法）：

```
~/.agents/skills/<name>   ->  <repo>/resources/skills/<name>   # 权威副本，指向仓库
~/.trae/skills/<name>     ->  ../../.agents/skills/<name>       # TRAE，软链回 .agents
~/.claude/skills/<name>   ->  ../../.agents/skills/<name>       # Claude Code，软链回 .agents
```

`~/.agents` 是权威副本、直接指向本仓库，所以在仓库里改 `SKILL.md` 立即生效，无需重装。要接入更多 Agent 目录（如 `~/.codex/skills`），在 `scripts/link-skills.sh` 顶部的 `MIRROR_DIRS` 数组里加一行即可。

脚本是幂等的、且只碰自己管理的软链：遇到真实文件/目录或指向别处的软链会跳过并告警，绝不删你的数据。

## 新增一个 skill

1. 建 `resources/skills/<name>/SKILL.md`，写好 `name` / `description`（description 决定触发准确度，写清“做什么 + 什么时候用”）。
2. 纯 workflow 就跑 `scripts/link-skills.sh` 安装；包绑定型交给所属包 build。
3. skill 通常在新会话或重新加载后才出现在 Agent 的 skills 列表里。
