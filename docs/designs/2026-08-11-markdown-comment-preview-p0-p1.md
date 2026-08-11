# Markdown Comment 预览能力 P0/P1 设计

## 背景

`packages/markdown-comment` 当前通过自建 VS Code Webview 渲染 Markdown，并在渲染结果上提供划词评论、全文评论、评论侧栏和源码跳转。渲染器只启用了基础 `markdown-it` 和 task list，与 VS Code 1.132 内置 Markdown 预览相比，缺少 Mermaid、数学公式、语法高亮、资源解析、导航和编辑器联动等能力。

本阶段保留自建 Webview。VS Code 内置预览的 `markdown.previewScripts`、`markdown.previewStyles` 和 `markdown.markdownItPlugins` 适合扩展显示效果，但没有受支持的通信通道让第三方脚本调用 Markdown Comment 的 Extension Host、共享评论存储或 CLI 契约。评论功能如果寄生在内置预览的 DOM 或私有消息上，会形成不稳定的编辑器耦合。

## 目标

完成 P0 和 P1，使评论预览足以作为日常 Markdown 阅读和评审入口。

### P0

- 渲染 Mermaid 11 fenced block。
- 支持对整张 Mermaid 图创建、定位、回复和解决评论。
- 正确解析 Markdown 文件相对路径、工作区绝对路径和受支持的远程图片。
- 正确处理相对链接、Markdown 文件链接和标题锚点。
- fenced code block 具备语法高亮。
- YAML front matter 可配置为表格、代码块或隐藏，默认表格。

### P1

- 使用 KaTeX 渲染行内和块级数学公式。
- code block 提供复制按钮。
- 编辑器滚动带动预览，预览滚动带动编辑器。
- 双击预览块跳到对应源码。
- Mermaid 支持平移、缩放、重置和复制源码。
- 文档重渲染时保留预览滚动锚点、`details` 展开状态和内容未变的 Mermaid 视图状态。

## 非目标

- 本阶段不实现 Mermaid 节点或边级评论。
- 不实现 VS Code rendered diff。
- 不加载 CDN 脚本、远程字体或运行 Markdown 内嵌脚本。
- 不改变评论存储真源，不迁移已有 `StoredDocument.version = 1` 数据。
- 不把渲染逻辑放入 Markdown Comment 的 editor-neutral domain core；渲染属于 Webview adapter。
- 不复制 VS Code 内置预览的动态文件跟随和锁定预览。评论预览继续固定绑定一个文档。

## 总体架构

```text
Markdown document
      │
      ▼
Extension Host
  - 读取文档
  - 解析/授权本地资源 URI
  - 评论存储和源码定位
  - 编辑器滚动/选区事件
      │ postMessage
      ▼
Comment Preview Webview
  - markdown-it 同步生成带 source map 的 HTML
  - Mermaid / KaTeX / highlight.js 增强渲染
  - 评论选择和高亮
  - 预览导航、滚动、图表交互
```

保持现有原则：Host 独占评论持久化，Webview 只持有可丢弃的视图状态并发送用户意图。

## 模块划分

### `src/preview/markdown.ts`

负责创建和配置唯一的 `markdown-it` 实例：

- task list；
- source line attributes；
- front matter；
- fenced code block 语法高亮；
- KaTeX；
- 图片和链接渲染属性；
- Mermaid fence 转换为占位容器。

它输出普通 HTML，不直接操作评论、VS Code API 或浏览器全局。

### `src/preview/mermaid.ts`

负责 Webview 中 Mermaid 容器的异步生命周期：

- 初始化 Mermaid 11，使用当前 VS Code 明暗主题；
- `securityLevel: 'strict'`、`startOnLoad: false`；
- 为每次文档渲染建立 generation，丢弃过期异步结果；
- 将 SVG 注入预先创建的容器；
- 渲染错误时保留可读错误与原始源码；
- 管理 pan/zoom/reset/copy source；
- 按稳定的 diagram key 保存和恢复视图状态。

diagram key 由 Mermaid fenced block 的源码起始行和源码内容摘要组成。内容不变但文档其他位置变化时，优先通过源码行和摘要恢复；内容变化时不错误复用旧状态。

### `src/preview/navigation.ts`

负责纯浏览器侧交互：

- 计算当前预览滚动位置对应的源码行；
- 根据 Host 发来的源码行滚动到预览块；
- 双击块上报源码行；
- 捕获相对链接和标题链接；
- 保存、恢复普通滚动位置和 `details` 展开状态。

### `src/preview/webview.ts`

保留视图编排职责：

- 调用 Markdown renderer；
- 调用 Mermaid enhancer；
- 应用评论高亮；
- 渲染评论侧栏；
- 将选择、导航、滚动和评论意图发送给 Host。

不在该文件继续堆积 Mermaid、KaTeX或 URI 解析细节。

### `src/preview/panel.ts`

保留 VS Code adapter 职责：

- Webview 生命周期和 CSP；
- 为当前 Markdown 文件建立 `localResourceRoots`；
- 把允许的本地图片 URI转换成 Webview URI；
- 处理链接打开、标题跳转和源码显示；
- 监听可见编辑器滚动/选区并同步到 Webview；
- 接收 Webview 滚动行并调用 `revealRange`；
- 继续处理评论存储。

## Markdown 渲染

### Source map

所有块级 token 继续携带：

```html
data-line="<0-based start>"
data-end-line="<exclusive end>"
```

额外统一 class `mdc-source-block`，供评论、滚动同步和双击跳转共用。不得依赖 Mermaid SVG 内部结构进行源码定位。

### Front matter

只识别文档开头由 `---` 包围的 YAML front matter。

- 默认 `table`：递归对象和数组以安全 HTML 展示；
- `codeBlock`：作为 `yaml` code block 渲染；
- `hide`：不输出正文，但保留一个不可见 source-map anchor，避免后续块滚动映射漂移。

设置名为 `markdownComment.preview.frontMatter`，值为 `table | codeBlock | hide`。不复用或改写用户的 `markdown.preview.frontMatter`，避免两个预览器互相影响。

YAML 只解析数据，不执行 schema、自定义 tag 或函数。

### 代码高亮

使用浏览器可打包的 highlight.js core 和明确语言集合。首期覆盖 Markdown 文档中高频语言：

- JavaScript / TypeScript / JSX / TSX；
- JSON / YAML；
- Bash / Shell；
- CSS / HTML / XML；
- Python；
- Java / Kotlin；
- Go；
- Rust；
- C / C++；
- SQL。

未知语言安全回退为转义后的 plain text，不动态加载网络资源。

### KaTeX

使用 `markdown-it-texmath` + `katex`：

- `$...$` 为行内公式；
- `$$...$$` 为块级公式；
- KaTeX CSS和字体随 VSIX 本地打包；
- `throwOnError: false`，错误公式保留可读错误，不中断整篇文档渲染。

## 本地资源和链接

Webview 不能直接读取任意 `file:` URI，因此 Host 在每次 render message 中提供当前文档 URI、workspace roots 和允许读取的资源映射。

首期采用请求式解析，而不是扫描整个 Markdown：

1. renderer 给图片保存原始 `src` 到 `data-src`；
2. Webview 收集非 `http:`, `https:`, `data:` 的图片地址并一次上报；
3. Host 按当前文档目录或 workspace root 解析；
4. 只允许 `file:` URI，且路径必须位于当前文档目录或 workspace folder；
5. Host 用 `webview.asWebviewUri` 返回映射；
6. Webview 更新对应图片。

`localResourceRoots` 包含当前文档目录、workspace folders 和扩展资源目录。路径越界、文件不存在或不支持协议时保持 broken image，并给出可读 title。

链接处理：

- `#fragment`：在当前预览滚动到对应 heading；
- 相对 `.md` / Markdown-family 文件：交给 Host 打开目标 Markdown 源文件；
- 相对其他文件：使用 `vscode.open`；
- `http:` / `https:` / `mailto:`：使用 `vscode.env.openExternal`；
- `javascript:`、`data:text/html` 等协议拒绝；
- Mermaid 内部链接因 `securityLevel: 'strict'` 不启用。

## Mermaid 渲染

### Mermaid fence

` ```mermaid ` 生成：

```html
<div
  class="mdc-mermaid mdc-source-block"
  data-line="..."
  data-end-line="..."
  data-diagram-key="..."
>
  <div class="mdc-mermaid-canvas" aria-label="Mermaid 图"></div>
  <template class="mdc-mermaid-source">...</template>
</div>
```

源码经过 HTML escaping。Mermaid 从 `template.textContent` 取输入，禁止拼接未转义 HTML。

### 整图评论

整图评论继续使用既有 `StoredAnchor.kind = 'selection'`：

- Webview 的“评论此图”生成覆盖整个 Mermaid fenced block 的 `RenderedSelection`；
- `quote` 使用可读标签“Mermaid 图”，不尝试从 SVG 选中文字；
- Host 通过 block start/end line 建立源码范围 anchor；
- `anchor.quote` 保存 Mermaid opening fence 行；图内容修改时锚点不失效，整块高亮由 `anchor.target` 和 block source map 恢复；
- `anchor.rendered` 保存显示标签；
- 可选增加 `anchor.target = { kind: 'mermaid-diagram' }`，旧数据和旧 CLI 可忽略；
- 高亮直接作用于 `.mdc-mermaid` 外层。

这不会新增存储版本，也不会把评论绑定到 Mermaid 运行时 DOM。

### 为什么不做节点/边评论

Mermaid 各图类型的 SVG结构、ID和 diagram DB 不统一，也没有稳定的“SVG元素 → 源码 Range”公共 API。节点选择器、布局坐标或生成序号都会在 Mermaid 升级、重排和文本编辑后漂移。

后续若试验，只允许 Flowchart 中显式声明 ID 的节点，并必须支持定位失败时降级为整图评论。

## 消息协议

新增 Host → Webview：

```ts
{ type: 'render'; text; threads; renderOptions }
{ type: 'revealLine'; line; source: 'editor' }
{ type: 'resolvedResources'; requestId; resources }
```

新增 Webview → Host：

```ts
{ type: 'createBlockThread'; startLine; endLine; label; target; text }
{ type: 'resolveResources'; requestId; sources }
{ type: 'openLink'; href }
{ type: 'revealSourceLine'; line }
{ type: 'previewScroll'; line }
```

滚动同步消息携带来源，并在两端设置短暂 suppression window，避免 editor → preview → editor 循环抖动。

## 状态保持

文档更新不保存到评论存储，只保存在 Webview 内存：

- 普通滚动：记录 source line + block 内比例，不只记录像素；
- `details`：以 source start line + summary text 摘要为 key；
- Mermaid：以 diagram key 保存 scale、translate 和用户调整后的高度；
- 当前选中的评论 ID 和侧栏 tab 延续现有内存状态。

重新渲染顺序：

1. 捕获旧状态；
2. 同步生成新 Markdown DOM；
3. 异步解析资源和 Mermaid；
4. 恢复 `details`；
5. Mermaid 完成后恢复图表状态；
6. 恢复 source-relative scroll；
7. 重新应用评论高亮。

## 安全

- Webview CSP 保持 `default-src 'none'`。
- 所有脚本和样式本地打包，使用 nonce。
- Mermaid 使用 strict security。
- Markdown 原始 HTML继续默认关闭。
- front matter、code、错误信息和 Mermaid 源码全部 escape。
- 不允许任意本地路径读取；Host 负责 URI授权。
- 外部链接显式交给 VS Code API，不在 Webview 内直接导航。
- 渲染失败局部降级，不得阻断评论侧栏和其余 Markdown。

## 配置

新增：

```json
{
  "markdownComment.preview.frontMatter": "table",
  "markdownComment.preview.scrollPreviewWithEditor": true,
  "markdownComment.preview.scrollEditorWithPreview": true,
  "markdownComment.preview.doubleClickToSwitchToEditor": true
}
```

Mermaid 平移缩放、代码复制和 KaTeX 默认启用，本阶段不增加额外开关。

## 实施拆分

### Task A：Markdown renderer

写集：

- `src/preview/markdown.ts`
- 必要的 renderer 纯类型或样式模块

交付：

- source map；
- front matter；
- highlight.js；
- KaTeX；
- Mermaid placeholder；
- image/link data attributes。

### Task B：Mermaid runtime

写集：

- `src/preview/mermaid.ts`
- Mermaid 专属样式模块

交付：

- 安全异步渲染；
- 错误降级；
- pan/zoom/reset/copy；
- 状态保存恢复；
- 整图评论入口事件。

### Task C：Host 与评论集成

写集：

- `src/preview/messages.ts`
- `src/preview/panel.ts`
- `src/anchor.ts`
- `src/types.ts`
- `src/extension.ts`
- `package.json`

交付：

- block comment anchor；
- 资源解析；
- 链接导航；
- 双向滚动和源码跳转；
- 配置和 CSP。

### Task D：Webview 编排

写集：

- `src/preview/webview.ts`
- `src/preview/navigation.ts`
- 共用预览样式

交付：

- renderer/runtime 接入；
- 评论逻辑回归；
- code copy；
- 状态恢复；
- Host 消息联动。

Task A/B 可并行。Task C 与 D 以消息协议先冻结、后并行实现，最后集中集成。

## 验证

### 静态验证

```sh
emo run check --filter './packages/markdown-comment'
emo run build --filter './packages/markdown-comment'
python3 scripts/test-agent-neutrality.py
python3 scripts/check-agent-neutrality.py
```

构建后检查 VSIX不引用 CDN，Webview bundle 不包含 Node built-in。

### 自动化 fixture

新增覆盖 P0/P1 的 Markdown fixture，至少包含：

- front matter 嵌套对象和数组；
- 本地相对图片、工作区绝对图片、远程图片；
- 当前标题、其他 Markdown 和普通文件链接；
- 已知/未知语言代码块；
- 行内和块级数学公式；
- Mermaid 正常图和语法错误图；
- `details`；
- Mermaid 前后可评论文本。

若当前 package 仍无测试框架，不为本次强行引入完整 browser test runner；优先把 renderer 的纯逻辑拆成可由 Node smoke script 验证的边界，并用 VSIX手工验收交互。

### 手工验收

1. 打开 fixture 的评论预览。
2. 验证 P0/P1 所有渲染项。
3. 对普通文本划词评论。
4. 对 Mermaid 整图评论，编辑前文使图表行号变化，确认评论仍定位到图。
5. 修改 Mermaid 内容，确认异步结果不串图且错误可恢复。
6. 编辑器和预览双向滚动，确认不循环抖动。
7. 双击普通块和 Mermaid 外层，确认定位源码。
8. 修改文档，确认滚动锚点、`details` 和内容未变的 Mermaid 视图状态保留；已删除的锚点安全回退到最近源码块。
9. 使用 CLI读取、回复和解决 Mermaid 整图评论。

## 完成标准

- P0/P1 功能均可在一个离线 VSIX中使用。
- 原有全文评论、普通划词评论、回复、编辑、解决、删除和 CLI流程无回归。
- 已有 version 1 评论数据无需迁移。
- 所有自动检查通过。
- 独立 review 无 blocker/high，或已完成一轮集中修复并复审通过。

