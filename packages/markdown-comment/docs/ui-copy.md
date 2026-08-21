# UI 文案清单

所有 Markdown Comment 扩展中用户能看到的文案（VS Code UI、通知、QuickPick、Webview）。
每个条目给出：位置 / 上下文 / 当前文案，方便你直接改。
改完后告诉我，我来同步到源码。

---

## 1. package.json — 命令面板 / 菜单 / 设置

### 1.1 扩展市场元信息

| key | 位置 | 当前文案 |
|-----|------|----------|
| displayName | 扩展市场/已安装列表 | `Markdown Comment` |
| description | 扩展市场 | `为 Markdown 文档建立可重定位评论线程，并提供 VS Code、CLI 与 Agent Skill 接入。` |

### 1.2 命令标题（command palette / 右键菜单 / 评论微件）

| command | 位置 | 当前文案 |
|---------|------|----------|
| markdown-comment.add-comment | 编辑器右键菜单 / 快捷键 ⌥⌘M | `Markdown Comment：添加划词评论` |
| markdown-comment.add-document-comment | 编辑器右键菜单 | `Markdown Comment：添加全文评论` |
| markdown-comment.open-preview | 编辑器标题栏 / 右键菜单 | `Markdown Comment：打开评论预览` |
| markdown-comment.install-or-update-skill | 命令面板 | `Markdown Comment：安装 / 更新 Agent Skill` |
| markdown-comment.cleanup-skill | 命令面板 | `Markdown Comment：移除 Agent Skill` |
| markdown-comment.create-thread | 空评论线程的「开始评论」按钮 | `评论` |
| markdown-comment.reply | 评论线程里的「回复」按钮 | `回复` |
| markdown-comment.resolve | 未解决线程标题栏 | `标记为已解决` |
| markdown-comment.reopen | 已解决线程标题栏 | `重新打开` |
| markdown-comment.edit-comment | 单条评论右上角 | `编辑` |
| markdown-comment.delete-comment | 单条评论右上角 | `删除` |
| markdown-comment.save-edit | 评论编辑态 | `保存` |
| markdown-comment.cancel-edit | 评论编辑态 | `取消` |
| markdown-comment.delete-thread | 评论线程右上角菜单 | `删除整条评论线程` |

### 1.3 设置（Settings UI）

| 配置 key | 当前文案 |
|----------|----------|
| configuration.title | `Markdown Comment` |
| markdownComment.sourceComments.enabled | **description**: `在 Markdown 源文件里启用内联（行）评论：编辑器左侧 + 号添加、Cmd/Ctrl+Alt+M、右键菜单。默认关闭——推荐用「打开评论预览」在渲染视图里评论。开关更改后需重载窗口生效。` |
| markdownComment.preview.frontMatter | **description**: `控制 Markdown Comment 预览如何显示文档开头的 YAML Front Matter。` |
| ├ enum "table" | `以键值表格渲染 YAML Front Matter。` |
| ├ enum "codeBlock" | `以 YAML 代码块渲染 Front Matter。` |
| └ enum "hide" | `隐藏 Front Matter。` |
| markdownComment.preview.scrollPreviewWithEditor | `滚动 Markdown 源码编辑器时，同步滚动评论预览。` |
| markdownComment.preview.scrollEditorWithPreview | `滚动评论预览时，同步滚动 Markdown 源码编辑器。` |
| markdownComment.preview.doubleClickToSwitchToEditor | `双击评论预览中的内容时打开源码并定位到对应行。` |
| markdownComment.preview.styles | `为 Markdown Comment 预览加载 workspace 内的本地 CSS 文件。` |
| markdownComment.preview.fontFamily | `Markdown Comment 预览字体；留空时使用 VS Code 字体。` |
| markdownComment.preview.fontSize | `Markdown Comment 预览字号（px）。` |
| markdownComment.preview.lineHeight | `Markdown Comment 预览行高。` |
| markdownComment.preview.breaks | `将段落内换行渲染为换行标签。` |
| markdownComment.preview.typographer | `启用 markdown-it 的排版替换。` |
| markdownComment.preview.html | `控制 Markdown Comment 预览中的原始 HTML。` |
| ├ enum "strict" | `不渲染 Markdown 原始 HTML。` |
| └ enum "safe" | `渲染经过严格清洗的静态 HTML。` |
| markdownComment.preview.renderedDiff | `在预览中标记当前未保存文本相对磁盘版本的增删改行。` |
| markdownComment.preview.mermaidNodeComments | `实验功能：允许评论 Mermaid Flowchart 中具有显式且唯一 ID 的节点。` |

---

## 2. src/extension.ts — 运行时消息 / QuickPick

### 2.1 评论线程标签（显示在编辑器 gutter / 线程头部）

| 场景 | 当前文案 |
|------|----------|
| 锚点失效（原文已删/改） | `⚠ 原文已变更（锚点失效）` |
| 全文评论线程 | `全文评论` |
| 划词评论线程（有选中文字） | `评论：「{选中摘要}」` |
| 划词评论线程（空选中/整行） | `评论` |
| 评论输入框 prompt | `评论` |
| 评论输入框 placeHolder | `写下你的评论…` |
| 评论作者名（兜底，取不到系统用户名时） | `You` |
| Agent 回复作者名 | `🤖 Agent` |

### 2.2 错误 / 提示消息（showInformationMessage / showErrorMessage）

| 触发场景 | 当前文案 |
|----------|----------|
| 在非 Markdown 文件里点「添加评论」且 sourceComments 开启 | `请在 Markdown 文件中操作` |
| 点「添加评论」但源码内联评论开关没开 | `源码内联评论已关闭。可在设置中开启 markdownComment.sourceComments.enabled，或使用「Markdown Comment：打开评论预览」在渲染视图中评论。` |
| 源码内联评论开关切换 | `Markdown Comment：源码内联评论设置已更改，重新加载窗口后生效。` （按钮：`重新加载窗口`） |
| 安装 skill 异常捕获 | `Markdown Comment：安装失败：{error}` |
| 移除 skill 异常捕获 | `Markdown Comment：移除失败：{error}` |
| 移除 skill 时没有已记录安装 | `Markdown Comment：当前没有已安装的 Agent Skill。` |

### 2.3 安装 / 更新 Agent Skill 命令（QuickPick + 结果通知）

| 场景 | 当前文案 |
|------|----------|
| QuickPick title | `Markdown Comment：安装 / 更新 Agent Skill` |
| QuickPick placeHolder | `选择要安装到的 Agent（可多选），Markdown Comment Skill 将注册到对应的 Agent 中` |
| 候选项 description（已安装过） | `已安装` |
| 候选项 description（目录不存在） | `（目录不存在，将自动创建）` |
| 自定义目录项 label | `$(add) 自定义目录…` |
| 自定义目录项 description | `手动输入其他目录` |
| 自定义目录 InputBox title | `自定义 Skill 目录` |
| 自定义目录 InputBox prompt | `输入目标 Agent 的 skills 目录绝对路径（支持 ~）` |
| **结果通知** | 见下方 2.5 |

### 2.4 移除 Agent Skill 命令（QuickPick + 结果通知）

| 场景 | 当前文案 |
|------|----------|
| QuickPick title | `Markdown Comment：移除 Agent Skill` |
| QuickPick placeHolder | `选择要从哪些 Agent 中移除（只会移除本插件创建的内容）` |
| 无已安装时提示 | `Markdown Comment：当前没有已安装的 Agent Skill。` |
| 移除失败 | `Markdown Comment：移除失败：{error}` |
| **结果通知** | 见下方 2.5 |

### 2.5 安装/移除结果通知

拼装规则：`Markdown Comment：{parts.join('；')}`，parts 可能包含：

| 场景 | 当前片段 |
|------|----------|
| 全新安装 N 个 | `已安装到 {n} 个 Agent` |
| 旧版升级 N 个 | `已更新 {n} 个旧版本` |
| 已是最新 | `已是最新版本（{n} 个 Agent）`（仅在无安装/无升级时显示） |
| 安装失败异常 | `Markdown Comment：安装失败：{error}` |
| 移除 N 个 | `已从 {n} 个 Agent 移除` |
| 跳过某目录 | `跳过 {~路径}：{reason}` |
| 无变更兜底 | `安装完成` / `没有变更` |

**跳过 reason（来自 src/skill-install.ts）：**

| kind | reason 文案 |
|------|-------------|
| foreign-link（安装时） | `该位置已被其他内容占用，未改动` |
| foreign-real（安装时） | `该位置已存在同名文件/目录且不是本 Skill，未改动` |
| missing（移除时） | `该位置原本没有安装，无需清理` |
| foreign-link / foreign-real（移除时） | `该位置不是本 Skill 创建的内容，未删除` |
| 兜底 | `未处理` |

---

## 3. src/preview/panel.ts / webview.ts — 评论预览侧栏

| 位置 | 当前文案 |
|------|----------|
| 全文评论按钮 | `＋ 全文评论`（title：`对整篇文档添加评论`） |
| 侧栏展开/收起（展开态） | `收起侧边栏` |
| 侧栏展开/收起（收起态） | `展开侧边栏` |

---

## 4. src/preview/mermaid.ts — Mermaid 工具栏 / 错误提示

| 位置 | 当前文案 |
|------|----------|
| 工具栏 aria-label | `Mermaid 图操作` |
| 缩小按钮 | `缩小`（tooltip），按钮文字 `−` |
| 放大按钮 | `放大`（tooltip），按钮文字 `+` |
| 重置视图 | `重置视图`（tooltip），按钮文字 `重置` |
| 复制源码 | `复制 Mermaid 源码`（tooltip），按钮文字 `复制源码` |
| 评论此图 | `评论此图`（tooltip 和按钮文字） |
| Mermaid 渲染失败标题 | `Mermaid 图渲染失败` |
| 评论整图的线程 label | `Mermaid 图` |
| 节点可评论时 aria-label | `评论 Mermaid 节点 {nodeId}` |
| 节点 hover `<title>` | `评论节点 {nodeId}` |

---

## 5. src/cli.ts — CLI 终端输出（命令行用户/Agent 可见）

> 如果你只关心 VS Code UI，这一节可以不改。但如果想 CLI 体验也一致，可以一并调整。

| 场景 | 当前文案 |
|------|----------|
| 找不到存储指针 | `未找到评论存储。请先在 VS Code 里启动 Markdown Comment 插件（它会写入存储指针 ~/.markdown-comment/pointer.json）。` |
| 参数重复 | `{name} 只能传一次。` |
| 参数缺值 | `{name} 缺少目录参数。` |
| 未知参数 | `未知参数: {token}` |
| 多余位置参数 | `不支持的位置参数: {token}` |
| 线程类型前缀 — 全文 | `- [全文]` |
| 线程类型前缀 — Mermaid 节点 | `- [Mermaid 节点:{id}] {loc} 「{quote}」` |
| 线程类型前缀 — Mermaid 整图 | `- [Mermaid 图] {loc} 「{quote}」` |
| 线程类型前缀 — 划词 | `- [划词] {loc} 「{quote}」` |
| 线程类型前缀 — 整行 | `- [整行] {loc} 「{line}」` |
| 空行兜底 | `(空行)` |
| 列表文件标题行 | `{path}  {n} 条` |
| 已解决标记 | ` [已解决]` |
| 失联标记 | ` [失联]` |
| 整图兜底标记 | ` [降级到整图]` |
| list 空（作用域内） | `（当前目录下没有评论；加 -g 看全部）` |
| list 空（全局） | `（没有评论）` |
| reply 参数错误 | `用法: mdc reply <threadId> <text>` |
| reply 未找到 | `未找到 thread（或前缀不唯一）: {id}` |
| reply 成功 | `OK: 已回复 #{shortId}` |
| resolve 参数错误 | `用法: mdc resolve <threadId>` |
| resolve 未找到 | `未找到 thread（或前缀不唯一）: {id}` |
| resolve 成功 | `OK: 已标记已解决 #{shortId}` |
| init 目录为空 | `{label} 至少需要一个非空目录。` |
| 非交互未指定 skill 目录 | `非交互安装必须用 --skill-dir <目录> 或 --skill-dirs <目录列表> 明确指定 skill 目标。` |
| 交互提示输入 skill 目录 | `请输入一个或多个 skill 根目录（逗号分隔；每个目录下会创建 markdown-comment/）：\n> ` |
| 交互未输入 | `未指定 skill 目标目录；可用 --no-skill 跳过安装。` |
| init 冲突 | `--skill-dir 与 --skill-dirs 不能同时使用。` / `--no-skill 不能与 --skill-dir 或 --skill-dirs 同时使用。` |
| init 重复目标 | `跳过重复 skill 目标：{duplicate.target} → {duplicate.original}` |
| init 打包 vsix | `打包 vsix…` |
| init 安装插件 | `安装 VS Code 插件…` |
| init code 命令不在 PATH | `调用 \`code\` 失败。请确认 VS Code 的 code 命令在 PATH（VS Code 执行 "Shell Command: Install 'code' command in PATH"），或加 --no-extension 跳过。` |
| init 装完 skill | `已安装 skill → {SKILL.md 路径}（CLI = {cliCmd}）` |
| init 完成提示 | `\n完成。VS Code 执行 "Developer: Reload Window"，打开任意 .md 即可划词评论（在跑 F5 调试实例的话先关掉）。\n` |
| help 标题 | `markdown-comment（简写 mdc）<command>` |
| help 区块 — 给用户 | `给用户：` |
| help init 行 | 多行，具体见 cli.ts:456-462 |
| help 区块 — 给 Agent | `给 Agent：` |
| help list/reply/resolve 行 | 多行，具体见 cli.ts:464-470 |

---

## 6. bundled SKILL.md（dist/resources/skills/markdown-comment/SKILL.md）

> 这是发给 Agent 看的，不是给最终用户的。frontmatter description 和里面的说明文字可以调整语气，但要保持 Agent 能看懂。

主要可改字段：
- frontmatter `description`
- 「# markdown-comment」下面的引言段
- 各命令说明

如果需要改，我再单独列。
