## Why

现有扩展能圈、能存、能让 Agent 读，但交互把人当成闸门：拖要按 Shift、要再点发布、复制一长段 Markdown。改成写下即保存，复制短指令，Esc 后页面干净。

## What Changes

- 三种手势：单击元素、划选文字、拖区域（不按 Shift）。Esc 退出标注后钉子和队列仍在。
- 页面内悬浮清单：编号、删除、复制 `/dom-comment tabid:`。Esc 后标记 UI 从页面消失。
- 新评论提交即落盘，CLI 立刻可见。
- Skill 先解析 `tabid:` / `url:`；没有时再 `list --open`。
- 不改包名、存储根目录、Native Messaging 帧格式。

## Non-goals

- 不改名 PageMark / `pagemark` / `~/.pagemark`。
- 不重写 NM 协议，不上 IndexedDB、JSON Schema 工厂、ZIP 发行包。
- 不做跨域 iframe 内部锚点，不做 Playwright / CDP。
- 不做截图三档策略（保存时仍裁切 PNG）。
- 不做旧数据大迁移（无 `visibility` 的线程视为已发布）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chrome-annotation`: 页内清单、编号钉、三种手势、退出后保留标记。
- `tab-comment-store`: pending / published 与 batch。
- `agent-cli`: 无 tab 的 `list --open`；Skill 先找最近批次。

## Impact

- 扩展 overlay / popup / Skill / CLI 默认入口改变。
- 仍写 `packages/dom-comment/data/{tabId}.json`。
- 详细契约见 `docs/design.md` rev 7。
