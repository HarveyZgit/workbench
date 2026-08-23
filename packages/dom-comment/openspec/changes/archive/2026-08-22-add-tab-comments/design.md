## Context

产品契约以仓库内 `packages/dom-comment/docs/design.md` **rev 6** 为准。本文只记实现切分与不可从 spec 直接读出的决策。

## Goals / Non-Goals

**Goals:** 按 rev 6 交付扩展 + CLI + Skill；存储 tab 主键；截图 + 聚焦原 tab 复现。

**Non-Goals:** Playwright、CDP、cookie 导出、共享 markdown-comment core。

## Decisions

1. **实现顺序**与 docs/design.md PR Plan 一致：OpenSpec → Node 存储/CLI → native host → overlay → composer/截图 → 侧栏 → Skill → polish。
2. **core** 无 `chrome` / `node:fs` / DOM 全局。`ops.ts` 只给 CLI 与 native-host。扩展只 import identity/anchor/types。
3. **写盘**只经 native-host 或 CLI。扩展 `sendNativeMessage` 做 create/load；`connectNative` + `~/.dom-comment/host.sock` 做 `open --tab`。
4. **测试**用 Node 内置 `node:test` + 临时 `DOM_COMMENT_STORAGE_DIR`，不引入第二套测试框架。
5. **构建** PR 1 用 esbuild 打 `dist/cli.js`（node22 / ESM 或 CJS 与仓库一致即可，优先 CJS 以免 extension 之后打架）。Rush 登记包名 `dom-comment`。WXT 从 PR 3a 才加。

## Risks / Trade-offs

- [SW 被杀导致 socket 没了] → persist NM；不行 offscreen；CLI 失败改看截图。
- [tabId 复用] → sessionId + archive 旋转。
- [截图裁切 DPR] → 3b 用 fixture；失败仍保存文字。

## Open Questions

无。用户已拍板（含复现 = 截图 + 聚焦原 tab）。
