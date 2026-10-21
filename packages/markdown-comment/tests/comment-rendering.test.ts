import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCommentMarkdown } from '../src/preview/comment-rendering.ts';
import { createMarkdownRenderer } from '../src/preview/markdown.ts';

test('comments share Markdown features without adding document source anchors', () => {
  const source =
    '# Heading\n\n**bold**, *italic*, ~~removed~~ and [link](https://example.com)\n\n- item\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```';
  const html = renderCommentMarkdown(source, {}, 'thread/comment');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /hljs/);
  assert.doesNotMatch(html, /data-(?:end-)?line=|mdc-source-block/);
  assert.match(createMarkdownRenderer().render(source), /mdc-source-block/);
});

test('comment heading and footnote identifiers and links are scoped per comment', () => {
  const source = '# Heading\n\n[heading](#heading) note[^one]\n\n[^one]: footnote';
  const first = renderCommentMarkdown(source, {}, 'a/b');
  const second = renderCommentMarkdown(source, {}, 'a-b');
  const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids(first).length >= 3);
  assert.ok(ids(first).every((id) => !ids(second).includes(id)));
  for (const [, href] of first.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids(first).includes(href), `missing target ${href}`);
  }
  assert.doesNotMatch(first, /id="heading"|id="fn1"/);
});

test('comments reject executable raw HTML and dangerous Markdown URLs', () => {
  const source =
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n![bad](data:text/html;base64,PHNjcmlwdD4=)\n\n[command](command:workbench.action.closeWindow)';
  const html = renderCommentMarkdown(source);
  assert.doesNotMatch(html, /<script|<img[^>]*onerror|href="(?:javascript|command):|src="data:text\/html/i);
});

test('comment code remains escaped and Mermaid uses readable code, not an unrendered canvas', () => {
  const source = '```html\n<img id="fake" onerror="alert(1)">\n```\n\n```mermaid\nflowchart TD\nA --> B\n```';
  const html = renderCommentMarkdown(source);
  assert.match(html, /&lt;/);
  assert.match(html, /flowchart TD/);
  assert.doesNotMatch(html, /mdc-mermaid-canvas|data-diagram-key|<img/);
});

test('rendering never mutates the raw Markdown used for edit round trips', () => {
  const body = '  **bold**\n\n[link](https://example.com "title")\n\n```txt\n  raw\n```\n';
  const stored = { body };
  renderCommentMarkdown(stored.body, { breaks: true, typographer: true });
  assert.equal(stored.body, body);
});
