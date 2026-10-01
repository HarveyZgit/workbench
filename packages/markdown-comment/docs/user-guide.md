# Markdown Comment 用户文档

## 功能概览

Markdown Comment 为 Markdown 文档提供可重定位的评论线程，可在 VS Code 与 Obsidian（桌面版）中使用，评论数据与 CLI 共用，支持四种评论类型：

| 类型 | 说明 |
|------|------|
| 划词评论 | 选中文本后添加评论，锚定在源码选区上 |
| 全文评论 | 锚定在整篇文档上的评论 |
| Mermaid 整图评论 | 评论整个 Mermaid 图表 |

核心特性：

- **可重定位锚点**：文档被编辑后，评论自动跟随原文移动；原文被完全删除时标记为失联
- **渲染预览**：支持 Markdown 渲染、Mermaid 图表、KaTeX 公式、YAML Front Matter
- **双向同步**：源码与预览滚动同步、双击预览跳转源码
- **CLI 接入**：Agent 可通过 `markdown-comment` CLI 的 `list`、`reply`、`resolve` 命令操作评论
- **Agent Skill**：安装后 Agent 可直接读取和回复评论，无需把整篇文档读入上下文

---

## 插件安装

Markdown Comment 以 VS Code 扩展（VSIX）形式分发。

### 前置要求

- VS Code `>= 1.85.0`
- Node.js `>= 22`

### 手动安装

1. 打开 VS Code 扩展面板（`Cmd+Shift+X` / `Ctrl+Shift+X`）
2. 点击右上角 `...` → **从 VSIX 安装…**
3. 选择 `.vsix` 文件即可完成安装

### 命令行安装

在终端执行：

```bash
code --install-extension <path-to-vscode-markdown-comment.vsix> --force
```

安装后重新加载 VS Code 窗口，打开任意 `.md` 文件即可使用。

---

## Skill 安装 / 更新 / 卸载

Skill 是给 Agent 看的操作指令，安装后 Agent 可以通过 CLI 读取和回复你的评论。两种方式等价，都需要先装好 VSIX（CLI 在扩展里）。

### 方式一：通过插件安装

1. 打开 VS Code 命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）
2. 运行 **Markdown Comment：安装 / 更新 Agent Skill**
3. 多选目标 Agent 目录（支持 `~/.trae/skills`、`~/.claude/skills` 等），也可手动输入自定义目录
4. 确认后，每个选中的目录下会创建 `markdown-comment/` 软链，指向 Skill 真源

更新时运行同样的命令即可。已安装的 Skill 会被刷新到最新版本，扩展启动时也会自动修复失效的软链。

### 方式二：自行安装 / Skill Hub

把打包产物 `dist/skill-hub/markdown-comment/` 整个目录放到 Agent 的 skills 根目录下，目录名保持 `markdown-comment`。上传 Skill Hub 时也传这一份。

自行安装的 Skill 通过同目录 `scripts/markdown-comment` 定位 CLI（`PATH`、`MARKDOWN_COMMENT_CLI`，或已安装的编辑器扩展），不依赖插件去改 SKILL.md。

### 卸载

1. 运行 **Markdown Comment：移除 Agent Skill**
2. 从已安装记录中多选要移除的目标
3. 确认后只删除本扩展创建的软链，不碰其他文件（含自行拷贝 / Skill Hub 安装的目录）

> 如果之后要卸载 VS Code 扩展本身，请先运行移除 Skill，否则会留下失效的软链。自行安装的目录需自己删。

---

## 如何使用

### 创建评论

在 VS Code 中打开 `.md` 文件，通过以下方式创建评论：

| 操作 | 方式 |
|------|------|
| 划词评论 | 选中文本 → 右键菜单 **添加划词评论**，或快捷键 `Cmd+Alt+M` / `Ctrl+Alt+M` |
| 全文评论 | 右键菜单 **添加全文评论**，或预览面板中点击「全文评论」按钮 |
| Mermaid 整图评论 | 预览面板中 Mermaid 工具栏点击「评论此图」 |
| Mermaid 节点评论 | 预览面板中点击节点上的评论按钮（需在设置中开启实验功能） |

### 打开评论预览

运行命令面板中的 **Markdown Comment：打开评论预览**，或右键菜单选择该命令。

预览面板功能：

- 渲染后的 Markdown（语法高亮 + KaTeX 公式 + Mermaid 图表）
- 侧栏按「未解决 / 已解决 / 全部」三个标签页展示评论卡片；「全文评论」右侧按钮可收起/展开侧栏（划词或点开评论时会自动展开）
- 每条评论卡片显示引用原文、作者、时间、操作按钮（回复、编辑、删除、标记已解决）
- 双击预览内容跳转到源码对应行
- 未保存改动的渲染差异标记

### 管理评论

在预览面板或源码编辑器中：

- **回复**：点击评论线程中的「回复」按钮
- **编辑**：点击单条评论右上角的「编辑」
- **删除**：点击单条评论右上角的「删除」，或线程右上角菜单中的「删除整条评论线程」
- **标记已解决**：点击未解决线程标题栏的「标记为已解决」
- **重新打开**：点击已解决线程标题栏的「重新打开」

### 让 Agent 处理评论

安装 Skill 后，你可以直接对 Agent 下达指令，例如：

- "看看我在文档里的评论"
- "逐条回复我标注的问题"
- "列出当前目录下所有未解决的评论"
- "回复 #abc123 这条评论"

也可在评论预览工具栏点「复制 Skill 提示」，把 `/markdown-comment <target>` 粘贴给 Agent：

- **已落盘文件**：`<target>` 为该文件的**绝对路径**（不是 workspace 相对路径）
- **Untitled**：`<target>` 为 CLI 短 id `u_<8hex>`（不是 `untitled:Untitled-1`）；该未保存文档至少有一条评论后才能复制。默认 `list`（当前目录）不会列出 untitled，Agent 需用 `list -g` 或你给出的 `u_*`

Agent 会通过 CLI 自动读取评论、逐条回复并标记已解决，无需你手动操作。装过新版扩展后，若 Agent 仍按旧说明行事，请再跑一次命令面板 **Markdown Comment：安装 / 更新 Agent Skill**（激活时也会 reconcile 刷新真源）。

### 常用设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `markdownComment.preview.frontMatter` | `table` | YAML Front Matter 显示方式：`table` / `codeBlock` / `hide` |
| `markdownComment.preview.scrollPreviewWithEditor` | `true` | 源码滚动时同步滚动预览 |
| `markdownComment.preview.scrollEditorWithPreview` | `true` | 预览滚动时同步滚动源码 |
| `markdownComment.preview.doubleClickToSwitchToEditor` | `true` | 双击预览跳转源码 |
| `markdownComment.preview.fontFamily` | `""` | 预览字体（留空使用 VS Code 字体） |
| `markdownComment.preview.fontSize` | `14` | 预览字号（px） |
| `markdownComment.preview.lineHeight` | `1.7` | 预览行高 |
| `markdownComment.preview.styles` | `[]` | 加载 workspace 内的本地 CSS 文件 |
| `markdownComment.preview.renderedDiff` | `true` | 在预览中标记未保存的改动 |
| `markdownComment.preview.mermaidNodeComments` | `false` | 实验：Mermaid Flowchart 节点评论 |

---

## 在 Obsidian 中使用

Obsidian 插件与 VS Code 扩展、CLI 读写同一份评论数据：同一篇笔记在两边看到的是同一组线程；Agent 在 vault 目录下执行 `markdown-comment list --open`，就能看到你在 Obsidian 里留的评论，`reply` / `resolve` 后侧栏会自动刷新。仅支持桌面版。

### 安装

```bash
rush build --to vscode-markdown-comment
ln -s <repo>/packages/markdown-comment/dist/obsidian "<vault>/.obsidian/plugins/markdown-comment"
```

然后在 Obsidian「设置 → 第三方插件」中启用 **Markdown Comment**。

### 存储目录

按以下顺序解析：环境变量 `MARKDOWN_COMMENT_STORAGE_DIR` → `~/.markdown-comment/pointer.json`（VS Code 扩展启动时写入）→ 插件设置里的「存储目录」。三者都没有时，创建评论会提示去设置里填写。插件不会写 `pointer.json`；只用 Obsidian 时，请让 CLI 通过 `MARKDOWN_COMMENT_STORAGE_DIR` 指向同一目录。

### 创建评论

| 场景 | 操作 |
|------|------|
| 阅读视图 · 划词 | 选中文字 → 点浮出的「💬 评论」，或运行命令 **添加划词评论** |
| 阅读视图 · 整块（图、表、callout） | 鼠标移到块上 → 点块右上角的「💬」 |
| 编辑视图 / 源码模式 · 划词 | 用鼠标选中文字 → 点浮出的「💬 评论」，或运行命令 **添加划词评论** |
| 编辑视图 / 源码模式 · 整块 | 光标放在块内 → 命令 **添加整块评论** |
| 全文评论 | 命令 **添加全文评论**，或侧栏顶部「全文评论」按钮 |

侧栏会出现草稿：可选标签（不清楚 / 有误 / 删 / 其他），写好正文后 `⌘/Ctrl+Enter` 提交，`Esc` 取消。标签作为正文前缀 `[标签] ` 写进第一条评论，CLI 输出里会直接带出。

阅读视图里，选词级的评论只在块源码能原样搜到所选文字时才精确锚定；选区包含粗体、`[[链接|别名]]` 等标记、或跨块时，会退回整块锚定，高亮仍按你当时选中的渲染文字绘制。

### 侧栏

- 「未解决 / 已解决 / 全部」三个标签页，带计数；
- 卡片显示标签、引用原文、评论列表（你与 Agent 的回复分开着色）、回复框；
- 卡片支持回复、标记为已解决 / 重新打开、删除整条线程（点两次确认）；
- 鼠标移到单条评论上会出现编辑、删除图标：编辑时 `⌘/Ctrl+Enter` 保存、`Esc` 取消，第一条评论的标签保持不变；删掉最后一条评论时整条线程一并移除；
- 原文被改动到找不到引用时，卡片标「失联」且不画高亮，与 CLI `list` 的 `[失联]` 判定一致；
- 阅读视图和编辑视图（Live Preview / 源码模式）都会高亮被评论的文字，整块评论在阅读视图里以淡色底标出；
- 点高亮定位到侧栏卡片；点卡片则选中该评论，正文滚到对应位置，并保持加深高亮直到选中别的评论；
- 命令 **复制 Skill 提示** 会复制 `/markdown-comment <笔记绝对路径>`，可直接交给 Agent。

### 已知限制

- 重命名 / 移动笔记后，评论不会跟着迁移（与 CLI、VS Code 行为一致，按绝对路径存储）；
- 多个 Obsidian 窗口或同时在 VS Code 里改评论时，最后写入者生效；
- 不渲染 Mermaid 节点评论（带 Mermaid target 的线程只由 VS Code / CLI 处理），也不做移动端；
- 浮动的「💬 评论」按钮只在主窗口生效，弹出窗口里请用命令。

---

## 未保存的 Markdown（Untitled）

`File → New File` 后将语言设为 Markdown（`untitled:` 文档）时，也可以：

- 打开评论预览（大纲 / 渲染）
- 在预览中创建、回复、解决评论
- 有评论后，用预览「复制 Skill 提示」得到 `/markdown-comment u_<8hex>`（稳定短 id；不要把 `untitled:Untitled-N` 当作 Agent/CLI 目标）

**另存为**到真实 `file:` 路径后，评论会自动迁移到新路径键，不会因保存丢失。

限制：

- 未保存时相对路径本地图片无法解析（没有磁盘目录）；`https://` 图片仍可用。另存为后如需本地图，可重新打开预览。
- Untitled 仅在 `languageId === markdown` 时启用；已落盘文件仍可用后缀兜底。
- 默认 CLI `list`（cwd 范围）不包含 untitled；要用 `list -g` 或显式传入 `u_*`。

