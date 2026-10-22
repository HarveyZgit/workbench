/** Synthetic browser integration check, not VS Code host E2E.
 * Build first; run with PLAYWRIGHT_MODULE pointing to an installed Playwright module.
 * CHROMIUM_EXECUTABLE may select a system Chromium. No network/user files are used.
 */
import { selectionRangeFixtures, verifyHighlightLifecycle } from './selection-range-fixtures.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panel = await readFile(path.join(packageRoot, 'src/preview/panel.ts'), 'utf8');
const style = /const STYLE = `([\s\S]*?)`;/u.exec(panel)?.[1];
const body = /<body>([\s\S]*?)<script nonce=/u.exec(panel)?.[1];
assert.ok(style && body, 'panel template must be available');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  await page.setContent(`<style>${style}</style>${body}`);
  await page.addStyleTag({ path: path.join(packageRoot, 'dist/webview.css') });
  await page.evaluate(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => window.sent.push(message),
      getState: () => ({}),
      setState: () => {
        /* No persistent state in this fixture. */
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text) => {
          window.copied = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.addScriptTag({ path: path.join(packageRoot, 'dist/webview.js') });
  const options = {
    frontMatter: 'table',
    scrollPreviewWithEditor: false,
    scrollEditorWithPreview: false,
    doubleClickToSwitchToEditor: false,
    styles: [],
    fontSize: 14,
    lineHeight: 1.7,
    breaks: false,
    typographer: false,
    html: 'safe',
    renderedDiff: true,
    mermaidNodeComments: false,
  };
  const host = (message) =>
    page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), message);
  const check = async (
    text,
    startSelector,
    endSelector,
    expectedStart,
    expectedEnd,
    expectedText,
    boundary = false,
    config = {},
  ) => {
    await host({ type: 'render', text, threads: [], options });
    await page.evaluate(
      ({ startSelector, endSelector, boundary, config }) => {
        const startElement = document.querySelector(startSelector);
        const endElement = document.querySelector(endSelector);
        const start = config.textNodes ? startElement.firstChild : startElement;
        const end = config.textNodes ? endElement.lastChild : endElement;
        const range = document.createRange();
        range.setStart(start, config.startOffset ?? 0);
        range.setEnd(
          end,
          config.endOffset ?? (boundary ? 0 : config.textNodes ? end.length : end.childNodes.length),
        );
        window.getSelection().removeAllRanges();
        if (config.reverse) {
          window
            .getSelection()
            .setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
        } else {
          window.getSelection().addRange(range);
        }
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      },
      { startSelector, endSelector, boundary, config },
    );
    await page.getByRole('button', { name: '💬 评论', exact: true }).click();
    await page.locator('#sidebar-draft textarea').fill('range regression');
    await page.locator('#sidebar-draft textarea').press('Control+Enter');
    const message = await page.evaluate(() => window.sent.findLast((m) => m.type === 'createThread'));
    assert.ok(message, 'comment submitted');
    assert.equal(message.selection.blockStartLine, expectedStart, text);
    assert.equal(message.selection.blockEndLine, expectedEnd, text);
    const thread = {
      id: 'range-test',
      kind: 'selection',
      status: 'open',
      blockStartLine: expectedStart,
      blockEndLine: expectedEnd,
      quote: text.split('\n').slice(expectedStart, expectedEnd).join('\n'),
      rendered: {
        quote: message.selection.quote,
        before: message.selection.before,
        after: message.selection.after,
      },
      comments: [
        { id: 'comment', author: 'user', body: 'range regression', createdAt: '2026-01-01T00:00:00Z' },
      ],
    };
    await host({ type: 'commentResult', requestId: message.requestId, ok: true });
    // Reload the document with persisted wire ranges, not just a transient selection.
    await host({ type: 'render', text, threads: [thread], options });
    const highlighted = await page
      .locator('#content .mdc-block-hl, #content mark.mdc-hl')
      .evaluateAll((elements) =>
        elements.map((el) => {
          const clone = el.cloneNode(true);
          clone
            .querySelectorAll('.mdc-code-toolbar, .mdc-image-tools')
            .forEach((toolbar) => toolbar.remove());
          return clone.textContent;
        }),
      );
    assert.equal(highlighted.join('').replace(/\s+/g, ''), expectedText.replace(/\s+/g, ''), text);
    assert.equal(await page.locator('.mdc-code-toolbar mark').count(), 0);
    // Legacy/source comments without a rendered quote use the same bounded fallback.
    delete thread.rendered;
    await host({ type: 'threads', threads: [thread] });
    const fallback = await page
      .locator('#content .mdc-block-hl, #content mark.mdc-hl')
      .evaluateAll((elements) =>
        elements.map((el) => {
          const clone = el.cloneNode(true);
          clone
            .querySelectorAll('.mdc-code-toolbar, .mdc-image-tools')
            .forEach((toolbar) => toolbar.remove());
          return clone.textContent;
        }),
      );
    assert.equal(
      fallback.join('').replace(/\s+/g, ''),
      (config.fallbackText ?? expectedText).replace(/\s+/g, ''),
      `fallback: ${text}`,
    );
  };
  for (const [name, ...fixture] of selectionRangeFixtures) {
    try {
      await check(...fixture);
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  const list = Array.from({ length: 9 }, (_, i) => `${i + 1}. item ${i + 1}`).join('\n');
  await check(list, '#content li:nth-child(5)', '#content li:nth-child(7)', 4, 7, 'item 5 item 6 item 7');
  await check(
    list,
    '#content li:nth-child(5)',
    '#content li:nth-child(8)',
    4,
    7,
    'item 5 item 6 item 7',
    true,
  );
  await check(
    '- one\n- two\n- three\n- four',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    'two three',
  );
  await check(
    '- [ ] one\n- [x] two\n- [ ] three\n- [ ] four',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    'two three',
  );
  await check(
    '- parent\n  - child one\n  - child two\n- sibling',
    '#content li li:nth-child(1)',
    '#content li li:nth-child(2)',
    1,
    3,
    'child one child two',
  );
  await check(
    '- parent\n  - child one\n  - child two\n- sibling',
    '#content li > span',
    '#content li > span',
    0,
    1,
    'parent',
  );
  await check(
    '> first\n>\n> second\n>\n> third',
    '#content blockquote p:nth-child(2)',
    '#content blockquote p:nth-child(2)',
    2,
    3,
    'second',
  );
  await check(
    '| name | value |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n| three | 3 |',
    '#content tbody tr:nth-child(2)',
    '#content tbody tr:nth-child(2)',
    3,
    4,
    'two 2',
  );
  await check(
    'first\n\nsecond\n\nthird',
    '#content p:nth-child(2)',
    '#content p:nth-child(2)',
    2,
    3,
    'second',
  );
  await check('- <b>parent</b>\n  - child', '#content li > span', '#content li > span', 0, 1, 'parent');
  assert.equal(
    await page.evaluate(
      () => window.sent.findLast((m) => m.type === 'createThread').selection.spansMultipleBlocks,
    ),
    true,
  );
  await host({ type: 'render', text: '$x + y$', threads: [], options });
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#content .katex-html'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '💬 评论', exact: true }).waitFor({ state: 'visible' });
  await page.evaluate(verifyHighlightLifecycle);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: scoped selection and persisted highlights for ordered/unordered/task/nested lists, quotes, tables, paragraphs, and exclusive DOM endpoints.',
  );
} finally {
  await browser.close();
}
