# Markdown Comment · Zed 扩展

在 Zed 里安装本扩展后，用 slash command 调本地 `markdown-comment preview` CLI，在**系统浏览器**打开评论预览（与 VS Code 扩展共用存储）。

Zed 没有 WebView，预览不能嵌在编辑器里。

## 安装

1. 前置：本机有 Node.js，且已安装 **harveyz.vscode-markdown-comment**（或仓库已 build 出 `dist/cli.js`）
2. Zed 命令面板 → **`zed: install dev extension`**
3. 选中本目录：`packages/markdown-comment/zed`（需含 `extension.toml`）
4. 等 Zed 编译 WASM（首次可能要装 `wasm32-wasip2`）

装好后扩展页会显示 *Overridden by dev extension*（若曾装过同 id 市场版）。

## 使用

在 **Assistant** 面板输入：

```text
/mdc-preview path/to/file.md
```

路径相对当前项目根，或绝对路径。成功后会返回 preview 的 `url:`，并自动打开浏览器。

停止预览：扩展返回的 `kill <pid>`，或结束占用端口的进程。

## 和 VS Code 的关系

| | |
|--|--|
| VS Code 命令面板 | 互不影响 |
| CLI / 评论存储 | **故意共用** |
| 扩展 id | Zed：`markdown-comment`；VS Code：`harveyz.vscode-markdown-comment` |

## 可选：Task / 快捷键

同目录仍保留 `tasks.json` / `keybindings.example.json` / `scripts/`，适合用 `$ZED_FILE` 预览当前文件（slash command 目前拿不到“当前 buffer”路径）。

```bash
# 可选：把 Task 合并进 ~/.config/zed/tasks.json
bash scripts/install-user.sh
```

## 能力声明

扩展通过 `process:exec` 调用 `node` / `markdown-comment` / `sh`。若你收紧了 `granted_extension_capabilities`，需放行这些命令。
