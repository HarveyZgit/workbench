## Why

产品已能在本机用，但安装靠源码树的 `rushx setup`，并默认猜 `~/.agents/skills`。要做成可 `npm i -g` 的包：一个 CLI 负责安装 Skill、指出扩展目录，并继续提供运行时命令。

## What Changes

- GitHub Release 分发 `dom-comment-*.tgz`；用户全局安装该 tarball，再跑 `dom-comment install`。命令名是 `dom-comment`。
- `dom-comment install`：登记 Native Messaging；交互选择 Agent skill 目录（也可 `--target`）。不猜默认宿主。
- `dom-comment extension`：打印本机扩展目录，供 Chrome「加载已解压」。
- 运行时命令仍在同一 CLI：`list` / `reply` / `resolve` / `open` / `ping-host`。
- 已发布安装把数据写到用户目录，不再写进 npm 包内。源码树开发仍可用包内 `data/`。

## Non-goals

- 不上 Chrome Web Store，不自动加载扩展。
- 不发 Homebrew / pkg / Windows 安装器。
- 不把评论推进某个 Agent 聊天。
- 不改 Native Messaging 帧格式；CLI / Skill 名仍是 `dom-comment`。
