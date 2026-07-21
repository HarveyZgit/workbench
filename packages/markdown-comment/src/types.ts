/** 评论锚点：双重锚定 —— 行/列范围 + 选中文本快照 + 前后文片段，用于原文变更后重定位。 */
export interface StoredAnchor {
  /** selection: 划词评论，按范围+quote 定位；document: 全文评论，锚到文件顶部。 */
  kind: 'selection' | 'document';
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  /** 选中文本快照，重定位的主依据（document 类型为空）。 */
  quote: string;
  /** 选区前最多 40 字符，用于多处 quote 命中时消歧。 */
  before: string;
  /** 选区后最多 40 字符。 */
  after: string;
  /**
   * 渲染态选区快照（仅 webview 划词时有）：用户在 preview 里实际选中的渲染文字 + 前后文。
   * webview 用它在渲染 DOM 里精确画高亮（即便源码锚点退回了整块）；CLI 也可优先显示它。
   */
  rendered?: { quote: string; before: string; after: string };
}

export interface StoredComment {
  id: string;
  /** 'user' | 'agent'（agent 预留给后续 Agent 自动回复闭环）。 */
  author: string;
  body: string;
  createdAt: string;
}

export interface StoredThread {
  id: string;
  anchor: StoredAnchor;
  status: 'open' | 'resolved';
  comments: StoredComment[];
}

/** Markdown Comment 持久化文档的结构。 */
export interface StoredDocument {
  version: 1;
  threads: StoredThread[];
}
