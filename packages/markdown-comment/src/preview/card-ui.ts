// 评论侧栏的共用展示件：图标、作者名、相对时间。VS Code 预览与 Obsidian 侧栏共用，保证两边卡片一致。
// 纯字符串 / 纯函数，不依赖 DOM、vscode 或 obsidian。

// 内联 SVG 图标（currentColor，随主题）。
export const ICON_SOURCE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L2.5 8 6 12"/><path d="M10 4l3.5 4-3.5 4"/></svg>';
export const ICON_RESOLVE =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/></svg>';
export const ICON_DELETE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8"/></svg>';
export const ICON_SEND =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4v2.2a2 2 0 0 1-2 2H4"/><path d="M6.3 6.3L4 8.2l2.3 1.9"/></svg>';
export const ICON_EDIT =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/><path d="M9.5 4l2.5 2.5"/></svg>';
export const ICON_ADD_DOC =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h5.5L12.5 5.5V13.5H4z"/><path d="M9.5 2.5V5.5h3"/><path d="M6 8h4.5M6 10.5h3"/><circle cx="11.2" cy="11.2" r="2.3"/><path d="M11.2 10.2v2M10.2 11.2h2"/></svg>';
export const ICON_COPY_SKILL =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="3" width="7" height="9" rx="1.2"/><path d="M4 5.5H3.5A1.5 1.5 0 0 0 2 7v5.5A1.5 1.5 0 0 0 3.5 14H9"/><path d="M7.5 6.5h3M7.5 9h3"/></svg>';

export function authorName(author: string): string {
  return author === 'agent' ? '🤖 Agent' : '你';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 友好相对时间：<1分→1分钟内；<1时→x分钟前；<1天→x小时前；<1年→MM月DD日 HH:mm；否则带年份。 */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return '';
  }
  const d = new Date(t);
  const diffMin = (now - t) / 60000;
  if (diffMin < 1) {
    return '1 分钟内';
  }
  if (diffMin < 60) {
    return `${Math.floor(diffMin)} 分钟前`;
  }
  if (diffMin < 60 * 24) {
    return `${Math.floor(diffMin / 60)} 小时前`;
  }
  const md = `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return diffMin < 60 * 24 * 365 ? md : `${d.getFullYear()}年${md}`;
}
