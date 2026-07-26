// 判定「这是一份 Markdown 文档吗」。渲染引擎（markdown-it）本身不限后缀，
// 所以甄别只按后缀 + VS Code 的 markdown languageId，避免被别的扩展抢注 languageId
// （如把 SKILL.md / AGENTS.md 认成自定义语言）而导致预览/评论入口消失。
// 纯常量与纯函数，不依赖 vscode，供插件与将来的 core 复用。

/** VS Code 官方 markdown-basics 注册给 markdown 语言的后缀家族（去掉 .litcoffee/.ron/.workbook 等非 Markdown 历史项）。 */
export const MARKDOWN_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mkd',
  '.mkdn',
  '.mdwn',
  '.mdown',
  '.markdn',
  '.mdtxt',
  '.mdtext',
] as const;

/** package.json 里 when 子句用的后缀正则（resourceExtname 含前导点），需与 MARKDOWN_EXTENSIONS 保持一致。 */
export const MARKDOWN_EXTNAME_PATTERN = '\\.(md|markdown|mkd|mkdn|mdwn|mdown|markdn|mdtxt|mdtext)$';

/** 文件名后缀是否属于 Markdown 家族（大小写不敏感）。 */
export function hasMarkdownExtension(fsPath: string): boolean {
  const lower = fsPath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 是否按 Markdown 处理：languageId 是 markdown（正常情况），或后缀属于 Markdown 家族
 * （languageId 被别的扩展抢注时的兜底）。以渲染引擎能吃为准，只用后缀甄别，不锁死 languageId。
 */
export function isMarkdownDocument(languageId: string, fsPath: string): boolean {
  return languageId === 'markdown' || hasMarkdownExtension(fsPath);
}
