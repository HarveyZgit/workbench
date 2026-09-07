import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMarkdownRenderer } from '../src/preview/markdown.ts';

test('renderer covers front matter mermaid code math and images', () => {
  const renderer = createMarkdownRenderer({ typographer: true, breaks: true });
  const html = renderer.render(
    [
      '---',
      'title: Demo',
      'count: 1',
      'ok: true',
      'empty:',
      'items:',
      '  - a',
      '  - b',
      'nested:',
      '  k: v',
      '---',
      '',
      '# Heading',
      '',
      'See $E = mc^2$ and',
      '',
      '$$',
      '1+1=2',
      '$$',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '```unknownlang',
      'plain',
      '```',
      '',
      '    indented code',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '![logo](./logo.png)',
      '',
      '[link](https://example.com)',
      '',
      '- [ ] task',
    ].join('\n'),
  );
  assert.match(html, /mdc-front-matter/);
  assert.match(html, /mdc-mermaid/);
  assert.match(html, /data-src="\.\/logo\.png"/);
  assert.match(html, /language-ts|hljs/);
  assert.match(html, /katex|math/i);
  assert.match(html, /data-href="https:\/\/example.com"/);

  const hidden = renderer.render('---\ntitle: X\n---\n# H\n', { frontMatter: 'hide' });
  assert.match(hidden, /mdc-front-matter-hidden/);
  const code = renderer.render('---\ntitle: X\n---\n# H\n', { frontMatter: 'codeBlock' });
  assert.match(code, /mdc-front-matter-code/);
  const invalid = renderer.render('---\n:\n---\n# H\n');
  assert.match(invalid, /mdc-front-matter/);
  const details = renderer.render('<details open>\n<summary>More</summary>\n\ninside\n\n</details>\n');
  assert.match(details, /<details|More|inside/);
  const closedDetails = renderer.render('<details>\n<summary>More</summary>\n\ninside\n\n</details>\n');
  assert.match(closedDetails, /details/);
});

test('renderer covers task lists footnotes alerts deflist emoji and image policy', () => {
  const renderer = createMarkdownRenderer();
  const tasks = renderer.render('- [ ] unchecked\n- [x] checked\n1. [ ] ordered\n');
  assert.match(tasks, /task-list-item-checkbox/);
  assert.match(tasks, /<input[^>]*type="checkbox"[^>]*>/);
  assert.match(tasks, /contains-task-list/);
  assert.match(tasks, /checked=""/);

  const footnotes = renderer.render('See note[^1].\n\n[^1]: Footnote body.\n');
  assert.match(footnotes, /footnote|footnotes/i);
  assert.match(footnotes, /Footnote body/);

  const alert = renderer.render('> [!NOTE]\n> Hello alert\n');
  assert.match(alert, /mdc-alert|markdown-alert/);
  assert.match(alert, /data-alert="note"/);
  assert.match(alert, /Hello alert/);
  assert.doesNotMatch(alert, /\[!NOTE\]/);

  const deflist = renderer.render('Term\n: Definition one\n');
  assert.match(deflist, /<dl[\s>]/i);
  assert.match(deflist, /<dt[\s>]/i);
  assert.match(deflist, /<dd[\s>]/i);

  const emoji = renderer.render('smile :smile: rocket :rocket:\n');
  assert.doesNotMatch(emoji, /:smile:/);

  const httpImage = renderer.render('![x](http://example.com/x.png)\n');
  assert.doesNotMatch(httpImage, /<img\b[^>]*http:\/\/example\.com\/x\.png/i);
  assert.doesNotMatch(httpImage, /data-src="http:\/\/example\.com\/x\.png"/);

  const httpsImage = renderer.render('![ok](https://example.com/ok.png)\n');
  assert.match(httpsImage, /data-src="https:\/\/example\.com\/ok\.png"/);

  const comment = renderer.render('before\n\n<!-- hidden comment -->\n\nafter\n');
  assert.doesNotMatch(comment, /&lt;!--/);
  assert.doesNotMatch(comment, /hidden comment/);
  assert.match(comment, /before/);
  assert.match(comment, /after/);
});
