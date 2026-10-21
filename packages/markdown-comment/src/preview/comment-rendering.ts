import { createMarkdownRenderer, type MarkdownRenderOptions } from './markdown';

const renderer = createMarkdownRenderer({}, 'comment');

/** Render presentation only. The caller must keep the original body for editing/storage. */
export function renderCommentMarkdown(
  source: string,
  options: MarkdownRenderOptions = {},
  namespace = 'comment',
): string {
  // Encode each code point, rather than replacing punctuation: distinct comment IDs stay distinct.
  const prefix = `mdc-comment-${Array.from(namespace, (value) => value.codePointAt(0)!.toString(16)).join('-')}-`;
  const html = renderer.render(source, options);
  // Only touch attributes in actual rendered tags, never escaped code/text. All raw HTML has
  // already gone through the shared sanitizer. Scope headings, footnotes and safe-HTML IDs,
  // plus their fragment links, so they cannot collide with the document or another comment.
  return html.replace(/<[a-z][^>]*>/gi, (tag) =>
    tag.replace(/\b(id|href|data-href)="([^"]*)"/g, (attribute, name: string, value: string) => {
      if (name === 'id') {
        return `id="${prefix}${value}"`;
      }
      return value.startsWith('#') ? `${name}="#${prefix}${value.slice(1)}"` : attribute;
    }),
  );
}
