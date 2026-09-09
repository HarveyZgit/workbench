# Markdown Comment · Zed 扩展

Zed 没有内置 WebView。这个薄扩展负责一件事：对当前 Markdown 文件启动本机 `markdown-comment preview`，用**系统浏览器**打开评论 UI。评论写入与 VS Code / CLI 同一份存储。

## 安装

### 推荐：不装 Dev Extension（Task，无需 Rust）

Zed 的 Install Dev Extension 要本机编 WASM，经常不可用。**不要走那条路。**

1. `npm i -g ./markdown-comment-*.tgz`，确认 `markdown-comment` 在 PATH。
2. 一键合并任务：

```bash
markdown-comment zed-setup
```

会把本包 `zed/tasks.json` 合并进 `~/.config/zed/tasks.json`（同名 label 更新，不覆盖其它 task）。
3. 打开**已保存**的 `.md` → `task: spawn` → **Markdown Comment: 打开评论预览**。

也可以完全离开 Zed：`markdown-comment preview /path/to/file.md`。

可选：把 `keybindings.example.json` 合并进 keymap（默认 `cmd-alt-m`）。

### 可选：Install Dev Extension（`/mdc-preview` slash）

Zed 会在本机用 Rust 编译 WASM。**必须用 rustup**（不要用 Homebrew rust），并确保有 wasm target：

```bash
# 若尚未安装：https://rustup.rs
rustup target add wasm32-wasip1
# 新版 Zed 也可能用 wasm32-wasip2；若日志提示缺 target，再：
# rustup target add wasm32-wasip2
```

然后：

1. 先能跑 CLI（`npm i -g` tgz，或仓库 `rush build` + PATH / `MARKDOWN_COMMENT_CLI`）。
2. `markdown-comment extension zed` 打印扩展目录。
3. Zed → **Extensions → Install Dev Extension…** → 选该目录。

若出现 `Failed to install dev extension: failed to compile Rust extension`，先看 `~/Library/Logs/Zed/Zed.log`（或 Linux `~/.local/share/zed/logs/Zed.log`），并在本目录执行：

```bash
cargo build --target wasm32-wasip1 --release
```

编通后再重试 Install Dev Extension。临时用不了 slash 时，用上面的 Task 路径即可。

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
