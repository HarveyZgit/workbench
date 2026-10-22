/** Focused DOM behavior check. Set JSDOM_MODULE to an installed jsdom module.
 * Native keyboard activation and visual wrapping are covered by the browser check. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  entryPoints: [path.join(packageRoot, 'src/preview/code-copy.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'codeControls',
  write: false,
});
const dom = new JSDOM(
  '<main id="content"><pre class="mdc-source-block" data-line="4" data-end-line="8"><code data-code-language="ts"><span class="hljs-keyword">const</span> value = "long line";\n  indented\n\n</code></pre></main>' +
    '<aside class="mdc-body"><pre><code>comment code\n</code></pre></aside>',
  { runScripts: 'outside-only', url: 'https://fixture.invalid' },
);
const { window } = dom;
const { document } = window;
const copied = [];
Object.defineProperty(window.navigator, 'clipboard', {
  value: {
    writeText: (text) => {
      copied.push(text);
      return Promise.resolve();
    },
  },
});
const query = (selector) => {
  const element = document.querySelector(selector);
  assert.ok(element, selector);
  return element;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

try {
  const controls = window.eval(`${bundle.outputFiles[0].text}\ncodeControls;`);
  const originalCode = query('#content code');
  const originalPre = query('#content pre');
  const originalHtml = originalCode.innerHTML;
  const originalText = originalCode.textContent;
  controls.addCodeCopyButtons(document);

  const block = query('#content .mdc-code-block');
  const wrap = query('#content .mdc-code-wrap');
  const commentWrap = query('.mdc-body .mdc-code-wrap');
  assert.equal(block.dataset.line, '4');
  assert.equal(block.dataset.endLine, '8');
  assert.ok(block.classList.contains('mdc-source-block'));
  assert.equal(query('#content pre'), originalPre);
  assert.equal(query('#content code'), originalCode);
  assert.equal(originalPre.classList.contains('mdc-source-block'), false);
  assert.equal(originalPre.hasAttribute('data-line'), false);
  assert.equal(originalPre.hasAttribute('data-end-line'), false);
  assert.equal(document.querySelector('.mdc-body .mdc-source-block, .mdc-body [data-line]'), null);
  assert.equal(document.querySelector('pre button'), null);
  assert.equal(query('#content .mdc-code-language').textContent, 'ts');
  assert.equal(query('.mdc-body .mdc-code-language').textContent, 'txt');
  assert.equal(wrap.type, 'button');
  assert.equal(wrap.tabIndex, 0);
  assert.equal(wrap.getAttribute('aria-label'), '自动换行');
  assert.equal(wrap.getAttribute('aria-pressed'), 'false');
  assert.equal(block.classList.contains('mdc-code-wrap-enabled'), false);

  wrap.focus();
  wrap.click();
  assert.equal(document.activeElement, wrap);
  assert.equal(wrap.getAttribute('aria-pressed'), 'true');
  assert.ok(block.classList.contains('mdc-code-wrap-enabled'));
  assert.equal(commentWrap.getAttribute('aria-pressed'), 'false');
  assert.equal(originalCode.innerHTML, originalHtml, 'wrapping must not rewrite highlighted code');
  assert.equal(originalCode.textContent, originalText);
  assert.equal(wrap.getAttribute('aria-label'), '自动换行', 'toggle retains its accessible name');

  // Reinitializing the same content must preserve state and avoid duplicate controls/listeners.
  controls.addCodeCopyButtons(document);
  assert.equal(document.querySelectorAll('.mdc-code-wrap').length, 2);
  assert.equal(document.querySelectorAll('.mdc-code-copy').length, 2);
  assert.equal(wrap.getAttribute('aria-pressed'), 'true');
  query('#content .mdc-code-copy').click();
  await tick();
  assert.equal(copied.at(-1), originalText, 'copy excludes language and controls while wrapped');

  wrap.click();
  assert.equal(wrap.getAttribute('aria-pressed'), 'false');
  assert.equal(block.classList.contains('mdc-code-wrap-enabled'), false);
  commentWrap.click();
  assert.equal(commentWrap.getAttribute('aria-pressed'), 'true');
  assert.ok(query('.mdc-body .mdc-code-block').classList.contains('mdc-code-wrap-enabled'));
  assert.equal(block.classList.contains('mdc-code-wrap-enabled'), false);
  query('.mdc-body .mdc-code-copy').click();
  await tick();
  assert.equal(copied.at(-1), 'comment code\n');
  assert.equal(originalCode.innerHTML, originalHtml);
  assert.equal(block.dataset.line, '4');
  assert.equal(block.dataset.endLine, '8');

  console.log(
    'PASS: code wrap default/toggle/restoration, independent preview/comment state, accessible button state, idempotence, source mapping, exact code and copy payload.',
  );
} finally {
  window.close();
}
