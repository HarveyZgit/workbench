# Markdown Comment · Zed

在 Zed 里用**快捷键**打开系统浏览器评论预览（调本地 `markdown-comment preview` CLI，与 VS Code 扩展共用存储）。

Zed 没有 WebView，预览不能嵌在编辑器里；WASM 扩展也**不能**注册可快捷键绑定的编辑器命令（官方 issue 仍在排期），所以主路径是 **Task + keymap**。

## 推荐安装（快捷键）

前置：Node.js + 已装 **harveyz.vscode-markdown-comment**（或本仓库已 build `dist/cli.js`）。

在仓库或解压目录执行：

```bash
bash packages/markdown-comment/zed/scripts/install-user.sh
# 若已解压到某处：
# bash markdown-comment-zed/scripts/install-user.sh
```

会写入：

- `~/.config/zed/tasks.json` → Task **Markdown Comment: Preview current file**（`$ZED_FILE`）
- `~/.config/zed/keymap.json` → **`cmd-alt-m`**（Markdown 编辑器）触发该 Task

## 使用

1. 在 Zed 打开一个 `.md` 文件  
2. 按 **`⌘⌥M`**（`cmd-alt-m`）  
3. 系统浏览器打开预览；终端里可 `Ctrl+C` 停掉服务  

也可命令面板：`task: spawn` → **Markdown Comment: Preview current file**。

改快捷键：`zed: open keymap`，搜 `Markdown Comment` 或改 `cmd-alt-m`。

## 可选：Install Dev Extension

同目录也是合法 Zed 扩展（`extension.toml`）。`zed: install dev extension` 后可在 Assistant 用 `/mdc-preview path`，但**拿不到当前 buffer**，不如快捷键。

## 和 VS Code

| | |
|--|--|
| 命令 / 快捷键 | 互不覆盖 |
| CLI / 评论存储 | **故意共用** |
