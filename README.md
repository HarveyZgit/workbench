# AI Workbench

一个用于长期维护个人 AI 资产的 Monorepo：小工具、Agent Skills、Rules、CLI、MCP 服务，以及它们共享的配置与发布能力。

这里的目标不是把所有东西塞进一个大项目，而是让每项资产都能独立演进、清晰复用，并保持可验证、可发布、可安装。

## 当前内容

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `packages/markdown-comment` | Markdown 评论工具的目标包位；将承接 VS Code 扩展、CLI 与 Agent Skill | 迁移准备中 |
| `packages/config` | 可复用的 TypeScript、Rslib 与 Rstest 配置 | 已启用 |
| `infra` | Monorepo 依赖、Git hooks、提交规范与通用工程配置 | 已启用 |

后续资产按类型放入清晰的顶层目录或独立 package；每个可发布/可安装的工具都应有自己的 README、使用入口和验证方式。

## 第一个工具：Markdown Comment

`markdown-comment` 面向 Markdown 的审阅与协作：在渲染后的文档中划词或全文评论，由 CLI 供 AI Agent 读取、回复与解决，形成「人评论 → Agent 处理 → 原处回复」的闭环。

其计划包含三个可组合的部分：

- VS Code 扩展：评论预览、划词、侧栏线程与源码定位。
- CLI：供人和 Agent 列出、回复、解决评论。
- Skill：把评论处理流程接入不同 Agent 运行环境。

当前包位已建立；迁移会在确认包边界、发布方式和本地/Codex 使用体验后进行。

## 开发

本仓库使用 Eden Monorepo（`emo`）管理工作区。建议 Node.js 22 与 pnpm 10。

```sh
npm install -g @ies/eden-monorepo
emo install
```

在某个 package 下执行其定义的脚本：

```sh
emo build
emo test
```

或在仓库根目录按包筛选：

```sh
emo run build --filter './packages/markdown-comment'
emo run test --filter './packages/markdown-comment'
```

## 约定

- 新资产优先做成边界明确、可单独验证的 package。
- 面向 Agent 的能力同时提供简洁的人类文档和可执行的 Skill/CLI 入口。
- 不把个人运行时数据、构建产物或本机配置提交进仓库。
- 变更应附带适当的测试或可复现验证命令。

## 计划方向

- 统一沉淀并分发个人 Skills、Rules、CLI 与 MCP 服务。
- 为各类工具提供一致的安装、测试与发布体验。
- 让 VS Code、Codex 等不同入口可以共享同一套 AI 工作流与数据。
