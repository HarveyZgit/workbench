import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCommentMarkdown } from '../src/preview/comment-rendering.ts';
import { createMarkdownRenderer } from '../src/preview/markdown.ts';

const python = 'def greet(name):\n    """Say hello."""\n    print(f"Hello {name}")\n\ngreet("world")\n';
for (const [context, render] of [
  ['preview', createMarkdownRenderer().render],
  ['comment', renderCommentMarkdown],
] as const) {
  test(`${context}: explicit code languages and aliases win over detection`, () => {
    for (const language of ['js', 'ts', 'python', 'shell', 'HTML', 'ruby']) {
      assert.match(
        render(`\`\`\`${language} title\n${python}\`\`\``),
        new RegExp(`data-code-language="${language.toLowerCase()}"`),
      );
    }
    for (const language of ['txt', 'text', 'plaintext', 'none', 'nohighlight']) {
      const html = render(`\`\`\`${language}\n${python}\`\`\``);
      assert.match(html, /data-code-language="txt"/);
      assert.doesNotMatch(html, /class="hljs/);
    }
  });
  test(`${context}: detect distinctive code, not ambiguous or plain text`, () => {
    assert.match(render(`\`\`\`\n${python}\`\`\``), /data-code-language="python"/);
    for (const source of [
      '',
      'hello',
      'This is ordinary prose about a nice day.',
      'const answer = 42;\nconsole.log(answer);',
      python.repeat(200),
    ]) {
      assert.match(render(`\`\`\`\n${source}\n\`\`\``), /data-code-language="txt"/);
    }
    assert.match(
      render(
        python
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      ),
      /data-code-language="python"/,
    );
  });
  test(`${context}: fence labels and code cannot inject markup`, () => {
    const html = render('```bad"><img/src=x/onerror=alert(1)>\n<img src=x onerror=alert(1)>\n```');
    assert.match(html, /data-code-language="txt"/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<img|<script/);
  });
}
