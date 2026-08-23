# resources/skills

独立 workflow Skill 的统一家。这里放不依赖某个 package 构建产物的 Skill 源文件，一处维护、按需安装。

## 宿主中立

- Skill 源文件不得固定某个 Agent、CLI、厂商、账号、邮箱、运行时目录或专属工具调用语法。
- 需要独立审查、委派、状态存储等能力时，描述能力契约与失败行为，不写死某个宿主的工具名。
- 平台专属的发现或发布文件只能做薄适配器：指向这里的源文件，不复制工作流、不定义默认身份、不成为状态真源。
- Skill 源文件不猜测安装目录。分发交给 `npx skills`（[vercel-labs/skills](https://github.com/vercel-labs/skills)），由使用者在安装时选择范围。

依赖 CLI 路径注入或其他 package 构建产物的 Skill 不放在这里，应随所属 package 维护。例如 `markdown-comment` 的 Skill 位于 `packages/markdown-comment/resources/skills/markdown-comment/`：可通过 VS Code 命令安装，也可使用打包出的 `dist/skill-hub/markdown-comment/` 自行安装或上传 Skill Hub。不要把它挂进仓库根的 `skills/` 目录。

## 目录约定

```
resources/skills/<skill-name>/
  SKILL.md          # 必需：frontmatter(name/description) + 指令正文
  scripts/          # 可选：可执行脚本
  references/       # 可选：按需加载的参考文档
  assets/           # 可选：模板等
```

仓库根的 `skills/<name>` 是给 `npx skills` 用的发现适配器，软链回这里。`npx skills` 只扫标准目录；如果没有 `skills/`，它会递归搜到 package 里的 Skill。

Skill 的评测定义、夹具和测试统一放在
`resources/evals/<skill-name>/`，不要放进会被全局安装的 Skill 目录。详见
[`resources/evals/README.md`](../evals/README.md)。

## 安装

仓库是私有的，本机已有 git / `gh` 登录即可：

```sh
npx skills add HarveyZgit/workbench
npx skills add HarveyZgit/workbench --skill eli5
npx skills add HarveyZgit/workbench -g
```

先看有哪些：

```sh
npx skills add HarveyZgit/workbench --list
```

安装目标由 `npx skills` 询问或用它自己的 flag 指定，不要在 Skill 源文件里写死。

## 新增一个 skill

1. 建 `resources/skills/<name>/SKILL.md`，写好 `name` / `description`（description 决定触发准确度，写清“做什么 + 什么时候用”）。
2. 在仓库根加发现软链：`skills/<name>` → `../resources/skills/<name>`。
3. skill 通常在新会话或重新加载后才出现在 Agent 的 skills 列表里。
