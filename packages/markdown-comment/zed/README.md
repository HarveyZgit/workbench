# Markdown Comment · Zed 扩展

Zed 没有内置 WebView。这个薄扩展负责一件事：对当前 Markdown 文件启动本机 `markdown-comment preview`，用**系统浏览器**打开评论 UI。评论写入与 VS Code / CLI 同一份存储。

## 安装

1. 先能跑 CLI（任选其一）
   - 仓库根目录：`rush build --to vscode-markdown-comment`，把 `packages/markdown-comment/dist/cli.js` 挂到 PATH，或 `export MARKDOWN_COMMENT_CLI=…/dist/cli.js`
   - 或安装 VS Code 扩展后，用其自带的 `dist/cli.js`
2. 打印扩展目录：

```bash
markdown-comment extension zed
```

3. Zed → **Extensions → Install Dev Extension…** → 选择上一步打印的目录（本仓库的 `packages/markdown-comment/zed`）。

## 使用

对**已保存**的 `.md` 文件：

| 方式 | 操作 |
|------|------|
| 命令 | 助手里 `/mdc-preview path/to/file.md`（省略参数时尝试 `ZED_FILE`） |
| 当前文件按钮 | 把 `tasks.json` 合并进 `~/.config/zed/tasks.json`，命令面板 `task: spawn` → **Markdown Comment: 打开评论预览** |
| 快捷键 | 把 `keybindings.example.json` 合并进 keymap（默认 `cmd-alt-m`） |

浏览器里：

- 划词 / 全文 / Mermaid 评论与 VS Code 预览相同
- 默认每 **5 秒**把未保存评论写入本地存储（`markdown-comment preview --sync-interval 5` 或 `~/.markdown-comment/config.json` 的 `syncIntervalSeconds` / 环境变量 `MARKDOWN_COMMENT_SYNC_INTERVAL`）
- 点 **保存** 立即写入
- 关闭标签页会做最后一次 flush
- 写入后 `markdown-comment list` 能看到

未保存（untitled）文档请继续用 VS Code 预览。

## 和 VS Code 共存

可以同时装。扩展 id 不同；CLI 名相同；评论数据刻意共用（已有 `~/.markdown-comment/pointer.json` 时沿用旧 VS Code globalStorage，否则 CLI 会在 `~/.markdown-comment/store` 建一份）。
