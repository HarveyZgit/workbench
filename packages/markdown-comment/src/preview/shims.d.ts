// markdown-it-task-lists 没有自带类型，给个最小声明让 tsc 通过。
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, opts?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }) => void;
  export default plugin;
}

declare module 'markdown-it-texmath' {
  import type { KatexOptions } from 'katex';
  import type MarkdownIt from 'markdown-it';

  interface TexmathOptions {
    delimiters?: string | string[];
    engine?: {
      renderToString: (source: string, options?: KatexOptions) => string;
    };
    katexOptions?: KatexOptions;
    outerSpace?: boolean;
  }

  const plugin: (md: MarkdownIt, options?: TexmathOptions) => void;
  export default plugin;
}


declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module 'markdown-it-deflist' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it';
  type EmojiPlugin = (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export const full: EmojiPlugin;
  export const light: EmojiPlugin;
  export const bare: EmojiPlugin;
}

// Webview 沙箱注入的全局：拿 postMessage 通道。
declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};
