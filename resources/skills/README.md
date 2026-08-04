# resources/skills

个人 Agent Skill 的统一家。这里放**跨宿主复用**的 Skill 源文件，一处维护、按需分发到用户显式指定的 skill 目录。

## 宿主中立

- Skill 源文件不得固定某个 Agent、CLI、厂商、账号、邮箱、运行时目录或专属工具调用语法。
- 需要独立审查、委派、状态存储等能力时，描述能力契约与失败行为，不写死某个宿主的工具名。
- 平台专属的发现或发布文件只能做薄适配器：指向这里的源文件，不复制工作流、不定义默认身份、不成为状态真源。
- 安装目标由用户显式传入，不由 Skill 猜测宿主目录。

## 两类 Skill

| 类型 | 特征 | 安装方式 |
| --- | --- | --- |
| **纯 workflow skill** | `SKILL.md` 里没有 `{{UPPER_SNAKE}}` 占位符，纯操作指令 | `scripts/link-skills.sh` 软链，改完即生效 |
| **包绑定型 skill** | `SKILL.md` 含 `{{CLI}}` 等大写占位符，需在所属包 build 时替换真实路径后拷贝安装 | 由所属 package 的 build 负责，`link-skills.sh` 会跳过 |

例：`review-and-commit` 和 `session-handoff` 是纯 workflow skill；`markdown-comment` 是包绑定型（CLI 路径 build 时注入）。

## 目录约定

```
resources/skills/<skill-name>/
  SKILL.md          # 必需：frontmatter(name/description) + 指令正文
  scripts/          # 可选：可执行脚本
  references/       # 可选：按需加载的参考文档
  assets/           # 可选：模板等
```

Skill 的评测定义、夹具和测试统一放在
`resources/evals/<skill-name>/`，不要放进会被全局安装的 Skill 目录。详见
[`resources/evals/README.md`](../evals/README.md)。

## 安装（纯 workflow skill）

```sh
scripts/link-skills.sh --dry-run --target <skill-dir>
scripts/link-skills.sh --target <skill-dir>
```

每个目标目录都直接链接到仓库源文件，不通过任何宿主目录中转：

```
<skill-dir>/<name> -> <repo>/resources/skills/<name>
```

可重复传入 `--target`，或通过 `AI_WORKBENCH_SKILL_DIRS` 提供以系统 PATH 分隔符分隔的多个目录。仓库里的 `resources/skills` 始终是唯一真源；安装脚本不知道目标目录属于哪个宿主。

脚本是幂等的、且只碰自己管理的软链：遇到真实文件/目录或指向别处的软链会跳过并告警，绝不删你的数据。

## 新增一个 skill

1. 建 `resources/skills/<name>/SKILL.md`，写好 `name` / `description`（description 决定触发准确度，写清“做什么 + 什么时候用”）。
2. 纯 workflow 就用 `scripts/link-skills.sh --target <skill-dir>` 安装；包绑定型交给所属包 build。
3. skill 通常在新会话或重新加载后才出现在 Agent 的 skills 列表里。
