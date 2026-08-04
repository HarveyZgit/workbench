# resources/skills

独立 workflow Skill 的统一家。这里放不依赖某个 package 构建产物的 Skill 源文件，一处维护、按需分发到用户显式指定的 skill 目录。

## 宿主中立

- Skill 源文件不得固定某个 Agent、CLI、厂商、账号、邮箱、运行时目录或专属工具调用语法。
- 需要独立审查、委派、状态存储等能力时，描述能力契约与失败行为，不写死某个宿主的工具名。
- 平台专属的发现或发布文件只能做薄适配器：指向这里的源文件，不复制工作流、不定义默认身份、不成为状态真源。
- 安装目标由用户显式传入，不由 Skill 猜测宿主目录。

依赖 CLI 路径注入或其他 package 构建产物的 Skill 不放在这里，应随所属 package 维护并由该 package 安装。例如 `markdown-comment` 的 Skill 位于 `packages/markdown-comment/resources/skills/markdown-comment/`，由 `mdc init` 安装。

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
2. 用 `scripts/link-skills.sh --target <skill-dir>` 安装。
3. skill 通常在新会话或重新加载后才出现在 Agent 的 skills 列表里。
