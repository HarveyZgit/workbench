/** Synthetic copy event/shortcut regression; native host coverage is separate. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/preview/selection-copy.ts', import.meta.url))],
  bundle: true,
  format: 'iife',
  globalName: 'selectionCopy',
  write: false,
});
const dom = new JSDOM(
  '<main id="content"><p>selected preview text</p></main><aside class="mdc-body">comment text</aside><textarea>editable text</textarea><div contenteditable="true">editable</div>',
  { runScripts: 'outside-only' },
);
const { window } = dom;
const { document } = window;
try {
  const api = window.eval(`${bundle.outputFiles[0].text}\nselectionCopy;`);
  const copied = [];
  api.installSelectionCopy((text) => copied.push(text));
  const select = (selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  };
  const key = (target, options) => {
    const event = new window.KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  };
  select('#content');
  assert.equal(key(document, { ctrlKey: true }).defaultPrevented, true);
  assert.deepEqual(copied, ['selected preview text']);
  const content = document.querySelector('#content');
  content.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  const context = JSON.parse(content.getAttribute('data-vscode-context'));
  assert.equal(context.mdcSelectedText, 'selected preview text');
  assert.equal(context.mdcHasSelection, true);
  assert.equal(context.preventDefaultContextMenuItems, true);
  document.querySelector('textarea').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(content.hasAttribute('data-vscode-context'), false, 'editable menu retains native actions');
  select('.mdc-body');
  assert.equal(key(document, { metaKey: true }).defaultPrevented, true);
  assert.equal(copied.at(-1), 'comment text');
  const native = new window.Event('copy', { bubbles: true, cancelable: true });
  const clipboard = {};
  Object.defineProperty(native, 'clipboardData', {
    value: {
      setData: (type, text) => {
        clipboard[type] = text;
      },
    },
  });
  document.dispatchEvent(native);
  assert.equal(native.defaultPrevented, true);
  assert.equal(clipboard['text/plain'], 'comment text');
  assert.deepEqual(
    copied,
    ['selected preview text', 'comment text', 'comment text'],
    'native copy also reaches host clipboard bridge',
  );
  for (const selector of ['textarea', '[contenteditable]']) {
    const input = document.querySelector(selector);
    input.focus();
    assert.equal(key(input, { ctrlKey: true }).defaultPrevented, false);
  }
  document.activeElement.blur();
  assert.equal(key(document, { ctrlKey: true, shiftKey: true }).defaultPrevented, false);
  assert.equal(key(document, { ctrlKey: true, altKey: true }).defaultPrevented, false);
  document.querySelector('#content').textContent = 'x'.repeat(10 * 1024 * 1024 + 1);
  select('#content');
  assert.equal(
    key(document, { ctrlKey: true }).defaultPrevented,
    false,
    'oversized host messages retain native copy',
  );
  window.getSelection().removeAllRanges();
  assert.equal(key(document, { ctrlKey: true }).defaultPrevented, false);
  content.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(content.hasAttribute('data-vscode-context'), false, 'no stale selection in context menu');
  console.log(
    'PASS: selected preview/comment copy via Ctrl/Cmd+C and native copy; editable controls and other shortcuts untouched.',
  );
} finally {
  window.close();
}
