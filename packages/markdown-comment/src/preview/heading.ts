import MarkdownIt from 'markdown-it';

type MarkdownToken = ReturnType<MarkdownIt['parse']>[number];

export function headingSlug(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function inlineText(token: MarkdownToken): string {
  if (!token.children) {
    return token.content;
  }
  return token.children
    .map((child) => {
      if (child.type === 'text' || child.type === 'code_inline') {
        return child.content;
      }
      if (child.type === 'image') {
        return child.content;
      }
      return '';
    })
    .join('');
}

export function headingTextFromInline(token: MarkdownToken): string {
  return inlineText(token);
}

export function findHeadingLine(source: string, fragment: string): number | null {
  const markdown = new MarkdownIt({ html: false });
  const tokens = markdown.parse(source, {});
  const counts = new Map<string, number>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || !token.map) {
      continue;
    }
    const base = headingSlug(headingTextFromInline(tokens[index + 1]));
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count}`;
    if (slug.toLowerCase() === fragment.toLowerCase()) {
      return token.map[0];
    }
  }
  return null;
}
