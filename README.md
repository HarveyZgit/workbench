# AI Workbench

一个用于长期维护个人 AI 资产的 Monorepo：小工具、Agent Skills、Rules、CLI、MCP 服务，以及它们共享的配置与发布能力。

这里的目标不是把所有东西塞进一个大项目，而是让每项资产都能独立演进、清晰复用，并保持可验证、可发布、可安装。

## 当前内容

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `packages/markdown-comment` | Markdown 评论工具：已迁入 VS Code 扩展、CLI 与 Agent Skill | 架构迁移中 |
| `packages/dom-to-markdown` | 本地 Manifest V3 Chrome 扩展：把页面/选区转为 Markdown | 已启用 |
| `tools/repo` | 仓库级 ESLint、Prettier 与 Git hooks | 已启用 |
| `resources/skills` | 独立 workflow Skill 源文件（`review-and-commit`、`session-handoff`），经 `scripts/link-skills.sh` 分发到本机各 Agent | 已启用 |
| `resources/evals` | 按 Skill 隔离的评测定义、夹具、测试与 iteration 产物 | 已启用 |

后续资产按类型放入清晰的顶层目录或独立 package；每个可发布/可安装的工具都应有自己的 README、使用入口和验证方式。

## 第一个工具：Markdown Comment

`markdown-comment` 是一个以 **Markdown 文档评论** 为核心的工具：为文档和选中文本建立可重定位的评论线程，并让人和 Agent 都能读取、回复与解决它们。

VS Code 扩展、CLI、Skill 和未来的其他 IDE / 本地 Web 页面，都是围绕同一评论核心的接入方式，而不是产品边界。这样评论数据、锚点和自动化流程不会被某一个编辑器绑定。

现有 VS Code 实现已迁入；编辑器无关核心的抽取是下一阶段工作。具体架构与开发约定由 `packages/markdown-comment` 自身维护。

## 开发

本仓库使用 Rush 管理工作区，底层包管理器是 pnpm。建议 Node.js 22。依赖从 npmjs 安装。

```sh
npm install -g @microsoft/rush
rush update
```

未全局安装 Rush 时可以用仓库脚本：

```sh
node common/scripts/install-run-rush.js update
```

在某个 package 目录执行其脚本：

```sh
rushx build
rushx typecheck
```

或在仓库根目录按包筛选：

```sh
rush build --to vscode-markdown-comment
rush typecheck --to vscode-markdown-comment
```

## 约定

- 新资产优先做成边界明确、可单独验证的 package。
- 面向 Agent 的能力同时提供简洁的人类文档和可执行的 Skill/CLI 入口。
- 独立 workflow Skill 用 `scripts/link-skills.sh --target <skill-dir>` 软链到用户显式指定的目录；包绑定型 Skill 随所属 package 构建和安装。安装与约定见 [`resources/skills/README.md`](resources/skills/README.md)。
- 不把个人运行时数据、构建产物或本机配置提交进仓库。
- 变更应附带适当的测试或可复现验证命令。

## 计划方向

- 统一沉淀并分发个人 Skills、Rules、CLI 与 MCP 服务。
- 为各类工具提供一致的安装、测试与发布体验。
- 让编辑器、CLI 与未来的 Agent 宿主通过薄适配器共享同一套 AI 工作流与数据。
