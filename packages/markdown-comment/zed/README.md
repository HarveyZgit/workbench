# Markdown Comment · Zed 集成

Zed **没有**内置浏览器 / WebView，扩展也不能在编辑器里嵌预览页。  
这个包用 **Zed Task** 调用同一个 `markdown-comment preview` CLI，在**系统浏览器**里打开评论预览（和 VS Code 插件共用评论存储）。

## 会不会和 VS Code 冲突？

| 东西 | 会冲突吗 |
|------|----------|
| VS Code 命令面板（打开评论预览等） | 否，只存在于 VS Code |
| CLI 名 `markdown-comment` | **共用同一个命令**，不是抢夺；两边调的是同一套 CLI |
| 评论数据 | **刻意共用**（`MARKDOWN_COMMENT_STORAGE_DIR` / `~/.markdown-comment`） |
| 扩展 id | VS Code：`harveyz.vscode-markdown-comment`；Zed 侧是 Task，不是同名扩展 |

结论：可以同时装。在 VS Code 里评论，在 Zed 里打开预览，数据是一份。

## 前置

1. 已安装 Markdown Comment **1.2.1+**（publisher `harveyz`），或本仓库已 `node esbuild.mjs --production` 出 `dist/cli.js`
2. 本机有 Node.js（跑 `preview.mjs` 与 CLI）

## 安装（推荐）

在仓库里执行：

```bash
bash packages/markdown-comment/zed/scripts/install-user.sh
```

会把脚本拷到 `~/.markdown-comment/zed/`，并把 Task 合并进 `~/.config/zed/tasks.json`。

## 使用

1. 在 Zed 打开一个 `.md` 文件  
2. 命令面板：`task: spawn` → **Markdown Comment: Preview current file (global install)**  
3. 系统浏览器打开预览；改 md 文件会刷新；划词评论写入同一存储

### 可选快捷键

`zed: open keymap`，合并 `~/.markdown-comment/zed/keybindings.example.json` 里的绑定（默认 `cmd-alt-m`，可按喜好改）。

### 只在 workbench 仓库里开发时

也可以用 Task **Markdown Comment: Preview current file**（路径指向 monorepo 内 `zed/scripts/preview.mjs`），无需 install-user。

## 排查

- 提示找不到 CLI：安装 VS Code 扩展，或 `export MARKDOWN_COMMENT_CLI=/path/to/dist/cli.js`
- 浏览器没开：看 Task 终端里打印的 `url:`，手动打开
- 评论对不上：确认 VS Code / Zed 没用不同的 `MARKDOWN_COMMENT_STORAGE_DIR`
