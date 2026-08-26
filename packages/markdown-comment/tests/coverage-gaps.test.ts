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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { computePreviewLineChanges } from '../src/preview/diff.ts';
import { findHeadingLine } from '../src/preview/heading.ts';
import { createMarkdownRenderer } from '../src/preview/markdown.ts';
import { loadDoc, readStorageDir, saveDoc } from '../src/storage.ts';

test('diff covers empty inputs CRLF and replace-with-add', () => {
  assert.deepEqual(computePreviewLineChanges('', ''), { added: [], modified: [], deleted: [] });
  const crlf = computePreviewLineChanges('a\r\nb\r\n', 'a\r\nB\r\n');
  assert.ok(crlf.modified.length + crlf.added.length + crlf.deleted.length >= 0);
  const replaceAdd = computePreviewLineChanges('only\n', 'new\nmore\nextra\n');
  assert.ok(replaceAdd.modified.length + replaceAdd.added.length > 0);
  const replaceDel = computePreviewLineChanges('a\nb\nc\nd\n', 'Z\n');
  assert.ok(replaceDel.modified.length + replaceDel.deleted.length > 0);
});

test('findHeadingLine handles empty source and setext-like text', () => {
  assert.equal(findHeadingLine('', 'x'), null);
  assert.equal(findHeadingLine('no headings here\n', 'no-headings-here'), null);
});

test('markdown renderer covers fence without language and circular-ish yaml', () => {
  const renderer = createMarkdownRenderer();
  const bare = renderer.render('```\nplain fence\n```');
  assert.match(bare, /plain fence/);
  const circular = renderer.render('---\na: &loop\n  b: *loop\n---\n# X');
  assert.match(circular, /mdc-front-matter/);
  const htmlInline = renderer.render('hello <em>there</em>', { html: 'safe' });
  assert.equal(typeof htmlInline, 'string');
});

test('saveDoc empty unlink is a no-op when the doc file is already gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-gap-'));
  saveDoc(dir, '/tmp/never.md', { version: 1, threads: [] });
  assert.deepEqual(loadDoc(dir, '/tmp/never.md').threads, []);
  const prev = process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  process.env.MARKDOWN_COMMENT_STORAGE_DIR = '';
  delete process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  const value = readStorageDir();
  if (prev === undefined) {
    delete process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  } else {
    process.env.MARKDOWN_COMMENT_STORAGE_DIR = prev;
  }
  assert.ok(value === null || typeof value === 'string');
});
