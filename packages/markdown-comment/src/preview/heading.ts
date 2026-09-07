import MarkdownIt from 'markdown-it';

type MarkdownToken = ReturnType<MarkdownIt['parse']>[number];

export interface HeadingNode {
  level: number;
  text: string;
  id: string;
  /** 0-based source line from markdown-it token.map, when available. */
  line: number | null;
  children: HeadingNode[];
}

export interface FlatHeading {
  level: number;
  text: string;
  id: string;
  line: number | null;
}

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

/** Flatten heading_open tokens into ordered headings with unique slug ids. */
export function collectHeadings(tokens: MarkdownToken[]): FlatHeading[] {
  const counts = new Map<string, number>();
  const headings: FlatHeading[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'heading_open') {
      continue;
    }
    const level = Number.parseInt(token.tag.slice(1), 10);
    if (!Number.isFinite(level) || level < 1 || level > 6) {
      continue;
    }
    const text = headingTextFromInline(tokens[index + 1]);
    const base = headingSlug(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.push({
      level,
      text,
      id: count === 0 ? base : `${base}-${count}`,
      line: token.map ? token.map[0] : null,
    });
  }
  return headings;
}

/**
 * Build a nested heading tree from markdown-it tokens (or markdown source).
 * Nesting follows document order: a heading becomes a child of the nearest
 * preceding heading with a smaller level.
 */
export function buildHeadingTree(sourceOrTokens: string | MarkdownToken[]): HeadingNode[] {
  const tokens =
    typeof sourceOrTokens === 'string'
      ? new MarkdownIt({ html: false }).parse(sourceOrTokens, {})
      : sourceOrTokens;
  const flat = collectHeadings(tokens);
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const item of flat) {
    const node: HeadingNode = {
      level: item.level,
      text: item.text,
      id: item.id,
      line: item.line,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/** Build a heading tree by walking rendered preview headings (h1–h6[id]). */
export function buildHeadingTreeFromDom(root: ParentNode): HeadingNode[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'));
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const el of elements) {
    const level = Number.parseInt(el.tagName.slice(1), 10);
    if (!Number.isFinite(level) || level < 1 || level > 6) {
      continue;
    }
    const id = el.id;
    if (!id) {
      continue;
    }
    const lineAttr = el.getAttribute('data-line');
    const line = lineAttr !== null && lineAttr !== '' ? Number(lineAttr) : null;
    const node: HeadingNode = {
      level,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      id,
      line: line !== null && Number.isFinite(line) ? line : null,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

export function findHeadingLine(source: string, fragment: string): number | null {
  const markdown = new MarkdownIt({ html: false });
  const tokens = markdown.parse(source, {});
  for (const heading of collectHeadings(tokens)) {
    if (heading.id.toLowerCase() === fragment.toLowerCase()) {
      return heading.line;
    }
  }
  return null;
}
