# Markdown Comment 预览能力 P2 设计

## 目标

在 P0/P1 已稳定交付的自建评论预览上补齐剩余高级能力：

- 本地自定义 CSS 和排版设置；
- 图片复制、打开源文件；
- 受控 Markdown HTML 和明确的预览安全等级；
- 当前未保存文本相对磁盘版本的 rendered diff；
- Mermaid Flowchart 显式节点 ID 的节点评论实验。

P2 继续作为 VS Code adapter 能力，不改变 Markdown Comment 的 editor-neutral core 边界。

## 非目标

- 不兼容任意 VS Code 内置 Markdown 插件脚本。
- 不执行 Markdown 中的脚本、事件属性、iframe、object 或 embed。
- 不允许不受限的远程 CSS。
- rendered diff 不替代源码 diff，不声称展示所有格式、空白或链接变化。
- Mermaid 节点评论不支持隐式节点 ID、边、subgraph、Sequence、State、Gantt、Mindmap 等图类型。
- 节点定位失败时不猜测其他 SVG 元素，自动降级显示为整图评论。

## 配置

新增：

```json
{
  "markdownComment.preview.styles": [],
  "markdownComment.preview.fontFamily": "",
  "markdownComment.preview.fontSize": 14,
  "markdownComment.preview.lineHeight": 1.7,
  "markdownComment.preview.breaks": false,
  "markdownComment.preview.typographer": false,
  "markdownComment.preview.html": "strict",
  "markdownComment.preview.renderedDiff": true,
  "markdownComment.preview.mermaidNodeComments": false
}
```

### `styles`

- 只接受当前 Markdown 文件目录或 workspace folder 内的本地 CSS 文件。
- Host 对真实路径做 `realpath` 边界检查。
- 未信任 workspace 中忽略 workspace 级样式。
- 单文件和总 CSS 数量、体积均设上限。
- Webview 只接收 `asWebviewUri` 后的 URI，不直接读取路径。

### 排版

- `fontFamily` 为空时继续使用 VS Code 字体。
- `fontSize` 限制在 8–40 px。
- `lineHeight` 限制在 1–3。
- `breaks` 和 `typographer` 直接配置独立 `markdown-it` 实例。

### HTML 安全等级

`markdownComment.preview.html`：

- `strict`：默认；原始 HTML 不渲染，保持 P0/P1 行为。
- `safe`：允许经过 DOMPurify 严格 allowlist 的静态 HTML。

`safe` 仍禁止：

- script/style/iframe/object/embed/form/input/button；
- `on*` 事件属性；
- `javascript:`、危险 data URI；
- 任意执行型或导航型自定义元素。

允许的主要元素是文本结构、table、details/summary、静态图片和普通链接。HTML 块外层仍保留 source map，评论锚点继续落在 Markdown 源码。

## 图片操作

每张渲染图片悬浮或聚焦时显示：

- **复制图片**：优先使用 `ClipboardItem` 写入 PNG；失败时复制原始图片地址。
- **打开源文件**：
  - 本地图片由 Host 解析并使用 `vscode.open`；
  - https 图片使用系统外部浏览器；
  - data URI 不提供打开按钮。

工具条不进入文本划词范围，不触发双击源码跳转。

## Rendered Diff

### 比较对象

- baseline：当前 Markdown 文件磁盘保存版本；
- current：VS Code `TextDocument.getText()`，包含未保存编辑；
- 只在 `document.isDirty` 且设置启用时计算。

### 输出

Host 使用明确依赖 `diff` 的 line diff，生成：

```ts
interface PreviewLineChanges {
  added: Array<{ startLine: number; endLine: number }>;
  modified: Array<{ startLine: number; endLine: number }>;
  deleted: Array<{ atLine: number; count: number }>;
}
```

- 相邻 removed + added chunk 视为 modified；
- 只有 added 视为 added；
- 只有 removed 在下一条当前行前显示 deletion marker；
- 不向 Webview 发送已删除正文，避免 rendered preview 伪装成完整源码 diff。

Webview 根据现有 `data-line` / `data-end-line` 将变化投影到渲染块：

- added：绿色 gutter；
- modified：蓝色 gutter；
- deleted：对应位置前的红色 marker，显示删除行数；
- 文档保存后自动清除。

## Mermaid Flowchart 节点评论

### 启用条件

同时满足：

1. `markdownComment.preview.mermaidNodeComments = true`；
2. Mermaid 源码首个有效声明为 `flowchart` 或 `graph`；
3. SVG 命中 `.node` 元素；
4. 能从 SVG DOM ID 和源码中得到相同的显式 node ID；
5. 源码中该 ID 只有一个可定位声明。

否则不显示节点评论入口，整图评论继续可用。

### 支持的源码声明

首期只识别一行一个节点声明或边中的显式端点：

```mermaid
A
A[Label]
A(Label)
A{Decision}
A --> B
A[Start] --> B[End]
```

ID 限制为 Mermaid 常用安全子集：

```text
[A-Za-z_][A-Za-z0-9_-]*
```

不解析 quoted ID、实体、HTML label、跨行声明、复杂 shape metadata。无法唯一定位时降级整图。

### 存储

扩展可选 target：

```ts
type StoredAnchorTarget =
  | { kind: 'mermaid-diagram' }
  | { kind: 'mermaid-node'; nodeId: string };
```

节点评论的源码 anchor 落在包含该 node ID 的源码行；`target.nodeId` 只用于在渲染图中定位和高亮。旧客户端忽略 target 后仍能按源码行显示普通 selection 评论。

### 渲染

- 节点 hover/focus 时显示“评论节点”入口；
- 节点评论高亮添加在 `.node` 外层；
- 找不到 nodeId 时，在 Mermaid 整图外层显示降级高亮，并在侧栏保留节点 label；
- 不保存 SVG selector、DOM ID、坐标或布局信息。

## 协议

`PreviewRenderOptions` 新增配置：

```ts
{
  styles: string[];
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  breaks: boolean;
  typographer: boolean;
  html: 'strict' | 'safe';
  renderedDiff: boolean;
  mermaidNodeComments: boolean;
}
```

与当前文本原子绑定的 diff 单独放在 render message：

```ts
{ type: 'render'; text; threads; options; diff?: { baseline: 'saved'; changes: PreviewLineChanges } }
```

新增 Webview → Host：

```ts
{ type: 'copyImageFallback'; source: string }
{ type: 'openImage'; source: string }
{ type: 'createMermaidNodeThread'; startLine; endLine; nodeId; label; text }
```

P2 的所有消息继续走运行时边界校验与长度限制。

## 任务拆分

### Task E：样式、排版和图片

写集：

- `package.json`
- `src/preview/panel.ts`
- `src/preview/messages.ts`
- `src/preview/webview.ts`
- `src/preview/webview.css`

### Task F：安全 HTML

写集：

- `src/preview/markdown.ts`
- 新增 `src/preview/sanitize.ts`
- 依赖和构建配置

### Task G：Rendered Diff

写集：

- 新增 `src/preview/diff.ts`
- `src/preview/panel.ts`
- `src/preview/messages.ts`
- `src/preview/webview.ts`
- `src/preview/webview.css`

### Task H：Flowchart 节点评论

写集：

- 新增 `src/preview/mermaid-node.ts`
- `src/preview/mermaid.ts`
- `src/preview/messages.ts`
- `src/preview/panel.ts`
- `src/types.ts`
- `src/preview/webview.ts`

由于 Task E/G/H 都需要接入相同入口，独立 worker 只编写新模块；主 Agent 统一修改共享文件并完成集成。

## 验证

- P0/P1 全部验证继续通过。
- renderer smoke 增加 strict/safe HTML、breaks、typographer。
- CSS 路径验证覆盖正常、越界、符号链接、未信任 workspace。
- 图片覆盖本地、https、data、复制失败 fallback。
- diff 覆盖 added、modified、deleted、保存后清除、空文件。
- 节点评论覆盖显式唯一 ID、重复 ID、复杂语法降级、非 flowchart 降级、节点删除后的整图降级。
- VSIX 继续零 CDN，所有依赖本地打包。

