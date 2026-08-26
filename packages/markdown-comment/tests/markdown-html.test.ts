import { JSDOM } from 'jsdom';

const g = globalThis as typeof globalThis & { document?: unknown };
if (typeof g.document === 'undefined') {
  const win = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
  }).window;
  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  define('window', win);
  define('document', win.document);
  define('DOMParser', win.DOMParser);
  define('NodeFilter', win.NodeFilter);
  define('Node', win.Node);
  define('Element', win.Element);
  define('DocumentFragment', win.DocumentFragment);
  define('HTMLTemplateElement', win.HTMLTemplateElement);
  define('NamedNodeMap', win.NamedNodeMap);
  define('HTMLFormElement', win.HTMLFormElement);
  define('Text', win.Text);
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMarkdownRenderer } from '../src/preview/markdown.ts';

test('html:safe strips script while keeping static markup', () => {
  const renderer = createMarkdownRenderer();
  const html = renderer.render('<p>ok</p><script>alert(1)</script><em>keep</em>', { html: 'safe' });
  assert.match(html, /ok|<p>|keep/);
  assert.doesNotMatch(html, /<script/i);
  const strict = renderer.render('<script>alert(1)</script>', { html: 'strict' });
  assert.doesNotMatch(strict, /<script>alert/);
});

test('details with nested fences and unclosed blocks', () => {
  const renderer = createMarkdownRenderer();
  const nested = renderer.render(
    '<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\ntext\n\n</details>\n\n</details>\n',
  );
  assert.match(nested, /details/);
  const fenced = renderer.render(
    ['<details>', '<summary>Code</summary>', '', '```javascript', '1', '```', '', '</details>'].join('\n'),
  );
  assert.match(fenced, /details|javascript|1/);
  const unclosed = renderer.render('<details>\nno close');
  assert.equal(typeof unclosed, 'string');
  const unclosedFm = renderer.render('---\ntitle: x\n');
  assert.doesNotMatch(unclosedFm, /mdc-front-matter-table-container/);
  const bom = renderer.render('\uFEFF---\ntitle: Bom\n---\n# Hi');
  assert.match(bom, /mdc-front-matter|Hi/);
});
