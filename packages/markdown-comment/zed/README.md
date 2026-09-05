# Markdown Comment · Zed

用**快捷键**打开系统浏览器评论预览（调本地 `markdown-comment preview` CLI，与 VS Code 扩展共用存储）。

Zed 没有 WebView，预览不能嵌在编辑器里；也不提供可注册自定义编辑器命令的扩展 API，所以用 **Task + keymap**。

## 安装

前置：Node.js + 已装 **harveyz.vscode-markdown-comment**（或本仓库已 build `dist/cli.js`）。

```bash
bash packages/markdown-comment/zed/scripts/install-user.sh
```

会写入：

- `~/.config/zed/tasks.json` → **Markdown Comment: Preview current file**（`$ZED_FILE`）
- `~/.config/zed/keymap.json` → **`cmd-alt-m`**（Markdown 编辑器）

## 使用

1. 打开一个 `.md` 文件  
2. 按 **`⌘⌥M`**  
3. 系统浏览器打开预览；终端里 `Ctrl+C` 可停服务  

也可：`task: spawn` → **Markdown Comment: Preview current file**。

改快捷键：`zed: open keymap`。

## 和 VS Code

命令 / 快捷键互不覆盖；CLI 与评论存储**故意共用**。
