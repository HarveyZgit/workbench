// markdown-it-task-lists 没有自带类型，给个最小声明让 tsc 通过。
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, opts?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }) => void;
  export default plugin;
}

// Webview 沙箱注入的全局：拿 postMessage 通道。
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
