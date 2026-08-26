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
