# AI Workbench

一个用于长期维护个人 AI 工具的 Monorepo：CLI、编辑器扩展、本机小工具，以及它们共享的配置与发布能力。独立 Agent Skills / Rules / Evals 在 [HarveyZgit/agents](https://github.com/HarveyZgit/agents)。

这里的目标不是把所有东西塞进一个大项目，而是让每项资产都能独立演进、清晰复用，并保持可验证、可发布、可安装。

## 当前内容

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `packages/markdown-comment` | Markdown 评论工具：已迁入 VS Code 扩展、CLI 与 Agent Skill | 架构迁移中 |
| `packages/dom-comment` | 页面 DOM 元素标记与评论 | 开发中（OpenSpec + CLI） |
| `packages/fast-finicky` | macOS 菜单栏 Chrome Profile 分流（Swift，不进 Rush） | 已启用 |
| `tools/repo` | 仓库级 ESLint、Prettier 与 Git hooks | 已启用 |
| [HarveyZgit/agents](https://github.com/HarveyZgit/agents) | 独立 workflow Skills、Rules、Evals | 已拆出 |

后续资产按类型放入清晰的顶层目录或独立 package；每个可发布/可安装的工具都应有自己的 README、使用入口和验证方式。

## 第一个工具：Markdown Comment

`markdown-comment` 是一个以 **Markdown 文档评论** 为核心的工具：为文档和选中文本建立可重定位的评论线程，并让人和 Agent 都能读取、回复与解决它们。

VS Code 扩展、CLI、Skill 和未来的其他 IDE / 本地 Web 页面，都是围绕同一评论核心的接入方式，而不是产品边界。这样评论数据、锚点和自动化流程不会被某一个编辑器绑定。

现有 VS Code 实现已迁入；编辑器无关核心的抽取是下一阶段工作。具体架构与开发约定由 `packages/markdown-comment` 自身维护。

## 开发

本仓库用 [Rush](https://rushjs.io/) 管理 monorepo，底层包管理器是 pnpm 10。依赖从 **npmjs** 安装（`common/config/rush/.npmrc`），不要用 bnpm。

环境：**Node.js 22**（`>=22 <23`）。Rush 会拒绝其它主版本。

### 安装

```sh
npm install -g @microsoft/rush
rush update
```

没有全局 Rush 时：

```sh
node common/scripts/install-run-rush.js update
```

`rush update` 会装依赖、生成 lockfile，并安装 Git hooks（husky / lint-staged / commitlint）。之后请用 `rush`，**不要在仓库根目录直接跑 `pnpm` / `npm install`**。

独立 catalog 以 git submodule 挂在 `vendor/agents`。克隆后执行 `git submodule update --init vendor/agents` 才能检出。`resources/skills`、`resources/rules`、`resources/evals` 是指向该 submodule 对应目录的符号链接。

### 常用命令

Rush 的 `--to` 用的是 **package.json 的 `name`**，不是目录名：

| 目录 | 包名 |
| --- | --- |
| `packages/markdown-comment` | `vscode-markdown-comment` |
| `packages/dom-comment` | `dom-comment` |
| `tools/repo` | `repo-tools`（仓库级 ESLint / Prettier / hooks，无业务产物） |

```sh
rush update                              # 安装 / 更新依赖
rush build                               # 按依赖顺序构建全部 package
rush build --to vscode-markdown-comment  # 只构建该包及其依赖
rush typecheck                           # 跑有 typecheck 脚本的包
rush test                                # 跑有 test 脚本的包
rush lint                                # ESLint
rush format                              # Prettier --write
rush format-check                        # Prettier --check（CI 用）
```

在某个 package 目录里跑它自己的 script：

```sh
cd packages/markdown-comment
rushx build
rushx typecheck
rushx package          # 打 VSIX
rushx watch            # 扩展开发时的增量构建
```

改本仓库里的包绑定 Skill 时再跑：

```sh
python3 scripts/test-agent-neutrality.py
python3 scripts/check-agent-neutrality.py
```

### 改代码时

- ESLint、Prettier 配置在仓库根：`.eslintrc.js`、`.prettierrc.json`。工具装在 `tools/repo`。
- 提交走 Conventional Commits（`feat` / `fix` / `chore` / `style` …）。`lint-staged` 会格式化并 lint 暂存的 JS/TS/JSON。
- 评测夹具不进 ESLint。
- 给某个包加依赖：

  ```sh
  rush add -p <npm-package> --dev --package vscode-markdown-comment
  ```

  然后 `rush update`。
- 新增可构建的 package：在 `packages/<name>/` 写 `package.json`，再登记到根目录 `rush.json` 的 `projects`，最后 `rush update`。目录必须是仓库根下恰好两级（`packages/foo`、`tools/foo`）。未就绪的目录（目前的 `figma-sync`、`http-cache-probe`）先不要登记。

各工具自己的用法看对应 package README。

## 约定

- 新资产优先做成边界明确、可单独验证的 package。
- 面向 Agent 的能力同时提供简洁的人类文档和可执行的 Skill/CLI 入口。
- 独立 workflow Skill 在 [HarveyZgit/agents](https://github.com/HarveyZgit/agents)，用 `npx skills add HarveyZgit/agents` 安装；包绑定型 Skill 随所属 package 构建和安装。
- 不把个人运行时数据、构建产物或本机配置提交进仓库。
- 变更应附带适当的测试或可复现验证命令。

## 计划方向

- 统一沉淀并分发个人 Skills、Rules、CLI 与 MCP 服务。
- 为各类工具提供一致的安装、测试与发布体验。
- 让编辑器、CLI 与未来的 Agent 宿主通过薄适配器共享同一套 AI 工作流与数据。
