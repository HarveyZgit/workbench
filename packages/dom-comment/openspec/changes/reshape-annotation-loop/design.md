## Context

rev 6 已交付扩展 + CLI + Skill，但交互把人当成胶水。本 change 只改用法和「何时对 Agent 可见」，不换管道。

产品契约以 `docs/design.md` **rev 7** 为准。

## Goals / Non-Goals

**Goals:** 页内编号队列；三种圈法；提交即落盘；复制 `/dom-comment tabid:`；Esc 收起页面标记 UI。

**Non-Goals:** 改名、换存储根、重写 NM 协议、IndexedDB、ZIP、iframe 内部锚点。

## Decisions

1. **提交即写盘**，CLI 立刻能 `list`。不另做发布步骤。
2. **复制给 Agent** 只复制 `/dom-comment tabid:<id>`，http(s) 页再加 `url:`。
3. **编号**在该页未解决线程上递增，删除后允许空号。
4. **拖满 8px 就是区域**，不按 Shift。单击是元素；未形成区域时的划词仍可当文字标记。标注模式仍拦截普通 click，避免点进链接。
5. **悬浮清单**是 Shadow overlay，不改 `body` 宽度。工具栏 popup 不再承担持续编辑。
6. **测试**继续 `node:test` + `DOM_COMMENT_STORAGE_DIR`。

## Risks / Trade-offs

- [划词与框选竞争] → 拖满 8px 走区域并清掉选区。
- [划词与元素单击竞争] → mouseup 若有非空选区则走文字，click 不再建元素评论。

## Open Questions

无。落地范围已在会话中拍板。
