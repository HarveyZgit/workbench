---
name: markdown-comment
description: 读取并回复 Markdown Comment 里的划词或全文评论。当用户说“看看我在文档里的评论/批注”、“逐条回复我标注的问题”，或要求处理 Markdown 上的人工评论时使用。通过 markdown-comment（简写 mdc）CLI 的 list、reply、resolve 命令操作评论，输出精简、省 token。
---

# markdown-comment

Markdown Comment 为 Markdown 提供划词和全文评论。本 skill 让你读取评论、逐条在原处回复并标记已解决，无需把整篇文档读进上下文。

## CLI

下文 `{{CLI}}` 是评论 CLI 命令（安装本 skill 时已替换为实际可执行路径）。当前迁移兼容层仍从 VS Code 全局存储定位评论数据，路径记录在 `~/.markdown-comment/pointer.json`。

前置：首次使用当前兼容实现时，用户必须在 VS Code 启动过插件一次（否则指针不存在，CLI 会给出提示）。

```bash
{{CLI}} list [file] [--open]    # 列出评论。默认只看当前目录（含子目录）下的文档、且隐藏失联评论；--open 只看未解决
{{CLI}} list --name-only        # 只列有评论的文件 + 条数（先扫一遍再决定看哪个）
{{CLI}} list --hidden           # 连已隐藏的失联评论（原文已删/被替换、定位不到）一并列出，标 [失联]
{{CLI}} list -g                 # 看全局所有文档（不限当前目录）
{{CLI}} reply <threadId> <text> # 以 Agent 身份回复（threadId 可用前 8 位短 id）
{{CLI}} resolve <threadId>      # 把线程标记为已解决
{{CLI}} list --json             # 需要结构化数据时输出原始 JSON
```

> 默认在**命令执行所在目录**下找有评论的 Markdown。处理某个项目的评论时，先 `cd` 到项目根再 `list`；要跨目录看全部用 `-g`。

`list` 默认输出紧凑文本，按文件分组，每条线程一行、评论缩进列出：

```text
/abs/path/to/foo.md
- [划词] L10 「被划选的原文摘要」  #43201ada
    - user: 这条没讲清
    - agent: 已补充第 3 节
- [整行] L17 「该行整行内容」  #2173d966
- [全文] #88ff00aa [已解决]
    - user: 整体结构调一下
```

- `[划词]/[整行]/[全文]`：评论锚定类型。划词=锚到选中文本（显示 quote）；整行=锚到整行（显示该行内容）；全文=锚到整篇文档。
- `L<行号>`：1-based 行号，跨行选区显示 `L起-止`（全文评论无行号）。
- `#xxxxxxxx`：threadId 前 8 位短 id，`reply`/`resolve` 用它定位（支持前缀匹配，歧义会报错）。
- 缩进 `- <author>: <body>`：`user` 是用户提的问，`agent` 是你已回的。
- 已解决线程行尾标 `[已解决]`。

不含全文、不含锚点细节，token 精简。需要原始结构用 `--json`。

## 工作流程

1. 用户让你处理评论时，先 `{{CLI}} list --open` 拿到所有未解决线程。
2. 按 `[类型]` 和 `「引用」` 理解每条问的是哪段；需要更多上下文时，再用行号去读对应 Markdown 的局部，不要整篇读入。
3. 逐条 `{{CLI}} reply <短id> "<回复>"`。回复以 `author: agent` 写回，用户在 VS Code 里即时看到（插件监听存储变化自动刷新）。
4. 已答复且无需跟进的，`{{CLI}} resolve <短id>`。

## 注意

- `threadId` 全局唯一，`reply`/`resolve` 不需要再传 file。
- 回复正文支持 Markdown。含空格的正文要用引号包起来。
- 不要直接手改全局存储里的 JSON——用 CLI，保证 index 同步、避免与插件写入冲突。
