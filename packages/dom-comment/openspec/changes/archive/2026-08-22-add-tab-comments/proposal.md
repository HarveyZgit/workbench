## Why

在自己的 Chrome 里对真实网页做 Codex 式标注（元素或框选 + 瞬间截图），并把「当前这个 tab」交给 Agent。现有 markdown-comment 只服务 Markdown 文件；按 URL 存一份文档也撑不住「同一 URL 两个 tab、同一 tab 换页」。

## What Changes

- 新增 `packages/dom-comment`：Chrome MV3 扩展 + 本地 JSON/PNG 存储 + CLI + 包内 Skill。
- 工具栏打开弹窗：图标开始/停止标记；两段可复制 prompt（`/dom-comment tabid:` / 带 `url:`）。
- 标注模式：悬停蓝框、拖拽框选、Esc 退出（页上有提示）；保存时裁切目标区域 PNG。
- 存储按当前 Chrome 会话的 tabId 分文件，文件内用 canonical URL 分页面和截图。
- Agent 用 CLI `list/reply/resolve`；复现先看截图，活页只 `open --tab` 聚焦原 tab。
- Native Messaging 写盘；Unix socket 把 CLI 的 focus 转到扩展。

## Non-goals

- 不抽与 markdown-comment 共享的 core，不合并存储。
- 不上 Playwright、CDP、cookie 导出无头分身。
- 无协同服务器、不上架、不做 Firefox/Safari。
- v1 用户只创建线程；扩展内不 reply/resolve（polish 再做钉和侧栏 resolve）。

## Capabilities

### New Capabilities

- `tab-comment-store`: 按 tabId + session 存线程；页面与 PNG 按 canonical URL 挂载。
- `agent-cli`: `list/reply/resolve/open` 与 Skill；参数 `tabid`/`url` 优先。
- `chrome-annotation`: popup、标注模式、元素/框选、Shadow 编写框、裁切截图并经 host 落盘。
- `tab-focus`: CLI 经 socket 聚焦已登录的原 tab；失败则停在截图。

### Modified Capabilities

无（本包尚无主 specs）。

## Impact

- 新包 `dom-comment`，登记 Rush；本机 `~/.dom-comment/`；macOS Chrome Load unpacked。
- 详细契约见 `docs/design.md` rev 6。
