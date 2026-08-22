---
name: dom-comment
description: 读取并回复用户在网页 DOM 上留下的评论。当用户说「看看我在页面/标签上的评论」、粘贴 `/dom-comment tabid:`，或要求处理页面标注时使用。通过 CLI 的 list、reply、resolve、open 操作，先看截图再决定是否聚焦原标签。
metadata:
  version: 0.0.1
---

# dom-comment

网页 DOM 元素/区域评论。只通过 CLI 读写，不要手改存储 JSON。

CLI 入口是本 Skill 目录下的 `scripts/dom-comment`（用 node 调用），它会定位包内 `dist/cli.js`。

```bash
node scripts/dom-comment list --tab <id> [--url <canonical>] [--open] [--json]
node scripts/dom-comment reply <threadId> <text>
node scripts/dom-comment resolve <threadId>
node scripts/dom-comment open --tab <id>
```

（在 Skill 根目录执行；或把 `scripts/dom-comment` 换成绝对路径。）

## 查找顺序

1. 用户消息里的 `tabid:<数字>` → `--tab`
2. 同时有 `url:<非空>` → 再加 `--url`（不要自己去抓这个网址）
3. 只有 tab → 该标签下所有页面
4. 都没有 → 从口语里找 URL；多个 tab 命中则列出 tabId 让用户收窄。不要默认列出全部 tab。

## 流程

1. `list --tab … --open`（需要结构化时加 `--json`）。
2. 行上有 `[截图]` 时，读取 `--json` 的 `screenshotAbs` 图片；那是评论瞬间的画面。
3. 按 `[元素]` / `[区域]` 和「quote」理解问题。
4. `reply <短id> "…"`，然后需要关闭时 `resolve`。
5. 还要看活页：`open --tab <id>` 只把用户 **已经打开且已登录** 的那个标签唤到前台。失败就停在截图。

## 禁止

- 不要 Playwright、不要 CDP、不要无痕/空 profile 打开目标站。
- 不要 `fetch` 该 URL 当页面真相（截图才是那一瞬间）。
- 不要手改存储 JSON。
