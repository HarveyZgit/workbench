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
import { sanitizeHtml, sanitizeInlineHtmlToken } from '../src/preview/sanitize.ts';

test('sanitizeHtml drops scripts and keeps safe tags', () => {
  const html = sanitizeHtml('<p>ok</p><script>alert(1)</script><img src="./x.png" alt="x">');
  assert.match(html, /<p>/);
  assert.match(html, /<img /);
  assert.doesNotMatch(html, /script/i);
});

test('sanitizeHtml rejects javascript urls and keeps relative images', () => {
  const html = sanitizeHtml('<a href="javascript:alert(1)">x</a><img src="./logo.png">');
  assert.doesNotMatch(html, /javascript/i);
  assert.match(html, /src="\.\/logo\.png"/);
});

test('sanitizeHtml keeps http(s) mailto and relative hrefs', () => {
  const html = sanitizeHtml(
    '<a href="https://ok.example">a</a><a href="mailto:a@b.c">m</a><a href="/rel">r</a><img src="https://ok.example/x.png" alt="x"><img src="data:image/png;base64,AAAA"><img src="http://insecure.example/x.png">',
  );
  assert.match(html, /https:\/\/ok\.example/);
  assert.match(html, /mailto:/);
  assert.doesNotMatch(html, /http:\/\/insecure/);
});

test('sanitizeInlineHtmlToken covers void tags and forbidden openings', () => {
  assert.match(sanitizeInlineHtmlToken('<br>'), /br/i);
  assert.match(sanitizeInlineHtmlToken('<img src="./x.png" alt="x">'), /img/i);
  assert.equal(sanitizeInlineHtmlToken('<button>'), '');
  assert.equal(sanitizeInlineHtmlToken('</br>'), '');
  const em = sanitizeInlineHtmlToken('<em>');
  assert.ok(em === '<em>' || em === '');
});
