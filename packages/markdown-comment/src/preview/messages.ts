// Webview ↔ extension host 的 postMessage 协议（纯类型，host 与 webview 共用）。

/** 评论在 wire 上的精简表示（host 从 StoredThread 投影出来发给 webview）。 */
export interface WireThread {
  id: string;
  status: 'open' | 'resolved';
  kind: 'selection' | 'document';
  target?: { kind: 'mermaid-diagram' };
  /** 锚定起点的源码行（0 基）；webview 用它定位渲染块。 */
  blockStartLine: number;
  /** 锚定终点行 + 1（排他），辅助定位跨行块。 */
  blockEndLine: number;
  /** 源码引用，侧栏兜底展示。 */
  quote: string;
  /** 渲染态引用，用来在渲染 DOM 里精确画高亮；无则退回整块高亮。 */
  rendered?: { quote: string; before: string; after: string };
  comments: { id: string; author: string; body: string; createdAt: string }[];
}

/** webview 捕获的渲染选区，上报给 host 翻译成源码范围。 */
export interface RenderedSelection {
  /** 选区起点所在块的源码起止行（0 基）。 */
  blockStartLine: number;
  blockEndLine: number;
  /** 渲染态选中文字。 */
  quote: string;
  /** 块内选区前/后最多 40 字符的渲染文字，用于多处命中消歧。 */
  before: string;
  after: string;
  /** 选区跨多个块：host 直接退回整块锚定，不做选词。 */
  spansMultipleBlocks: boolean;
}

export interface PreviewRenderOptions {
  frontMatter: 'table' | 'codeBlock' | 'hide';
  scrollPreviewWithEditor: boolean;
  scrollEditorWithPreview: boolean;
  doubleClickToSwitchToEditor: boolean;
}

export interface ResolvedPreviewResource {
  source: string;
  uri?: string;
  error?: string;
}

export type HostToWebview =
  | { type: 'render'; text: string; threads: WireThread[]; options: PreviewRenderOptions }
  | { type: 'threads'; threads: WireThread[] }
  | { type: 'revealThread'; threadId: string }
  | { type: 'revealLine'; line: number }
  | { type: 'resolvedResources'; requestId: string; resources: ResolvedPreviewResource[] };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'createThread'; selection: RenderedSelection; text: string }
  | {
      type: 'createBlockThread';
      startLine: number;
      endLine: number;
      label: string;
      target: 'mermaid-diagram';
      text: string;
    }
  | { type: 'createDocThread'; text: string }
  | { type: 'reply'; threadId: string; text: string }
  | { type: 'editComment'; threadId: string; commentId: string; text: string }
  | { type: 'resolve'; threadId: string; resolved: boolean }
  | { type: 'deleteComment'; threadId: string; commentId: string }
  | { type: 'deleteThread'; threadId: string }
  | { type: 'revealSource'; threadId: string }
  | { type: 'resolveResources'; requestId: string; sources: string[] }
  | { type: 'openLink'; href: string }
  | { type: 'revealSourceLine'; line: number }
  | { type: 'previewScroll'; line: number };
