# AI Workbench

个人 AI 工具 Monorepo：CLI、编辑器扩展、本机小工具。独立 Skills / Rules / Evals 在 [HarveyZgit/agents](https://github.com/HarveyZgit/agents)。

## 当前内容

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `packages/markdown-comment` | Markdown 评论：VS Code 扩展、CLI、Skill | 架构迁移中 |
| `packages/dom-comment` | 页面 DOM 元素标记与评论 | 开发中（OpenSpec + CLI） |
| `packages/fast-finicky` | macOS 菜单栏 Chrome Profile 分流（Swift，不进 Rush） | 已启用 |
| `tools/repo` | 仓库级 ESLint、Prettier 与 Git hooks | 已启用 |
| [HarveyZgit/agents](https://github.com/HarveyZgit/agents) | 独立 workflow Skills、Rules、Evals | 已拆出 |

用法见各 package README。独立 catalog 以 git submodule 挂在 `vendor/agents`；`resources/skills`、`resources/rules`、`resources/evals` 是指向它的符号链接。

## 开发

[Rush](https://rushjs.io/) + pnpm 10。依赖从 **npmjs** 安装（`common/config/rush/.npmrc`），不要用 bnpm。Node.js **22**（`>=22 <23`）。

```sh
git submodule update --init vendor/agents
npm install -g @microsoft/rush
rush update
```

没有全局 Rush 时用 `node common/scripts/install-run-rush.js update`。之后用 `rush`，不要在仓库根目录直接跑 `pnpm` / `npm install`。

`--to` 用的是 package.json `name`，不是目录名：

| 目录 | 包名 |
| --- | --- |
| `packages/markdown-comment` | `vscode-markdown-comment` |
| `packages/dom-comment` | `dom-comment` |
| `tools/repo` | `repo-tools` |

```sh
rush build --to vscode-markdown-comment
rush typecheck
rush test
rush lint
rush format            # CI 用 rush format-check
```

在 package 目录里用 `rushx` 跑该包脚本（如 `build`、`typecheck`、`package`、`watch`）。

改可复用 AI 资产、安装路径或宿主适配时：

```sh
python3 scripts/test-agent-neutrality.py
python3 scripts/check-agent-neutrality.py
```

加依赖：`rush add -p <npm-package> --dev --package vscode-markdown-comment`，再 `rush update`。新 package 放在 `packages/<name>/` 或 `tools/<name>/`（必须恰好两级），登记到 `rush.json` 的 `projects`，再 `rush update`。提交走 Conventional Commits。
