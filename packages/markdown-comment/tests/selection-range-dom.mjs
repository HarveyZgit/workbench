/** Synthetic DOM integration check. Build first, then run with JSDOM_MODULE pointing
 * to an installed jsdom module. This verifies behavior, not layout or VS Code E2E. */
import { selectionRangeFixtures, verifyHighlightLifecycle } from './selection-range-fixtures.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || 'jsdom');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panel = await readFile(path.join(packageRoot, 'src/preview/panel.ts'), 'utf8');
const body = /<body>([\s\S]*?)<script nonce=/u.exec(panel)?.[1];
assert.ok(body);
const virtualConsole = new VirtualConsole();
const errors = [];
virtualConsole.on('jsdomError', (error) => errors.push(error.message));
const dom = new JSDOM(body, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://fixture.invalid',
  virtualConsole,
});
const { window } = dom;
const { document } = window;
window.CSS = { escape: (value) => value }; // Fixture IDs are simple ASCII.
const sent = [];
window.acquireVsCodeApi = () => ({
  postMessage: (message) => sent.push(message),
  getState: () => ({}),
  setState: () => {
    /* Synthetic host no-op. */
  },
});
window.focus = () => {
  /* Synthetic host no-op. */
};
window.HTMLElement.prototype.scrollIntoView = () => {
  /* Synthetic host no-op. */
};
window.Range.prototype.getBoundingClientRect = () => ({
  top: 10,
  right: 100,
  bottom: 20,
  left: 0,
  width: 100,
  height: 10,
});
window.matchMedia = () => ({
  matches: false,
  addEventListener() {
    /* Fixture no-op. */
  },
  removeEventListener() {
    /* Fixture no-op. */
  },
});
const query = (selector) => {
  const result = document.querySelector(selector);
  assert.ok(result, selector);
  return result;
};
const host = (message) => window.dispatchEvent(new window.MessageEvent('message', { data: message }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
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
try {
  window.eval(await readFile(path.join(packageRoot, 'dist/webview.js'), 'utf8'));
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
    host({ type: 'render', text, threads: [], options });
    await tick();
    const startElement = query(startSelector);
    const endElement = query(endSelector);
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
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    await tick();
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent === '💬 评论');
    assert.notEqual(button.style.display, 'none');
    button.click();
    const input = query('#sidebar-draft textarea');
    input.value = 'range regression';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    const message = sent.findLast((m) => m.type === 'createThread');
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
    host({ type: 'commentResult', requestId: message.requestId, ok: true });
    host({ type: 'render', text, threads: [thread], options });
    const markedText = () =>
      [...document.querySelectorAll('#content .mdc-block-hl, #content mark.mdc-hl')]
        .map((el) => {
          const clone = el.cloneNode(true);
          clone
            .querySelectorAll('.mdc-code-toolbar, .mdc-image-tools')
            .forEach((toolbar) => toolbar.remove());
          return clone.textContent;
        })
        .join('')
        .replace(/\s+/g, '');
    assert.equal(markedText(), expectedText.replace(/\s+/g, ''), text);
    delete thread.rendered;
    host({ type: 'threads', threads: [thread] });
    assert.equal(
      markedText(),
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
    sent.findLast((m) => m.type === 'createThread').selection.spansMultipleBlocks,
    true,
    'safe HTML retains source-block fallback',
  );
  host({ type: 'render', text: '$x + y$', threads: [], options });
  const mathRange = document.createRange();
  mathRange.selectNodeContents(query('#content .katex-html'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(mathRange);
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await tick();
  assert.notEqual(
    [...document.querySelectorAll('button')].find((el) => el.textContent === '💬 评论').style.display,
    'none',
    'math-only selection remains commentable',
  );
  verifyHighlightLifecycle(window);
  await tick();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: scoped selection and reload/fallback highlights for list variants, nested parent text, quotes, tables, paragraphs and exclusive DOM boundaries.',
  );
} finally {
  window.close();
}
