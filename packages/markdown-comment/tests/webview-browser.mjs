/** Synthetic browser integration check, not VS Code host E2E.
 * Build first; run with PLAYWRIGHT_MODULE pointing to an installed Playwright module.
 * CHROMIUM_EXECUTABLE may select a system Chromium. No network/user files are used.
 */
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
  const raw = '  **bold**\n\n# Heading\n\n[link](https://example.com "title")\n\n```txt\n  raw\n```\n';
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  );
  const threads = [
    {
      id: 'thread-1',
      status: 'open',
      kind: 'document',
      blockStartLine: 0,
      blockEndLine: 1,
      quote: '',
      comments: [
        { id: 'comment-1', author: 'user', body: raw, createdAt: '2026-01-01T00:00:00Z' },
        {
          id: 'comment-2',
          author: 'agent',
          body: '<img src="x" onerror="window.xss=1"><script>window.xss=2</script>\n\n[bad](javascript:alert(1))',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
  ];
  const text = `# Heading\n\n\`\`\`txt\n${'long code '.repeat(100)}\n\`\`\``;
  const host = (message) =>
    page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), message);
  await host({
    type: 'render',
    text,
    threads,
    options,
    diff: {
      baseline: 'saved',
      changes: { added: [], modified: [{ startLine: 2, endLine: 5 }], deleted: [] },
    },
  });
  await page.waitForSelector('.mdc-body strong');
  assert.equal(await page.locator('.mdc-body strong').first().textContent(), 'bold');
  assert.equal(await page.evaluate(() => window.xss), undefined);
  assert.equal(
    await page.locator('.mdc-body script, .mdc-body [onerror], .mdc-body a[href^="javascript:"]').count(),
    0,
  );
  const code = page.locator('#content .mdc-code-block').first();
  assert.ok(
    await code.evaluate((element) => element.matches('.mdc-source-block.mdc-diff-modified[data-line="2"]')),
  );
  const before = await code.locator('button').boundingBox();
  await code.locator('pre').evaluate((element) => {
    element.scrollLeft = 300;
  });
  assert.ok(await code.locator('pre').evaluate((element) => element.scrollLeft > 0));
  const after = await code.locator('button').boundingBox();
  assert.equal(before.x, after.x);
  assert.ok(after.y + after.height <= (await code.locator('pre').boundingBox()).y);
  await code.locator('button').click();
  assert.equal(await page.evaluate(() => window.copied), `${'long code '.repeat(100)}\n`);

  await page.locator('[data-comment-id="comment-1"] [data-act="editComment"]').click();
  assert.equal(await page.locator('.mdc-edit-input').inputValue(), raw);
  await page.locator('.mdc-edit [data-act="editSave"]').click();
  const edit = await page.evaluate(() => window.sent.findLast((message) => message.type === 'editComment'));
  assert.equal(edit.text, raw);
  await host({
    type: 'commentResult',
    requestId: edit.requestId,
    ok: false,
    error: 'synthetic write failure',
  });
  assert.equal(await page.locator('.mdc-edit-input').inputValue(), raw);
  await page.locator('.mdc-edit [data-act="editCancel"]').click();

  await page.locator('#mdc-add-doc').click();
  const picker = page.locator('#sidebar-draft input[type="file"]');
  await picker.setInputFiles(
    ['first.png', 'second.png', 'third.png'].map((name) => ({ name, mimeType: 'image/png', buffer: image })),
  );
  await page.waitForFunction(
    () => document.querySelectorAll('#sidebar-draft .mdc-attachment-tile').length === 3,
  );
  await page.getByRole('button', { name: '前移 third.png', exact: true }).click();
  await page.getByRole('button', { name: '删除 first.png', exact: true }).click();
  await page.locator('#sidebar-draft [data-act="submit"]').click();
  const submit = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'createDocThread'),
  );
  assert.equal(submit.text, '');
  assert.deepEqual(
    submit.attachments.map((attachment) => attachment.name),
    ['third.png', 'second.png'],
  );
  await host({
    type: 'commentResult',
    requestId: submit.requestId,
    ok: false,
    error: 'synthetic storage failure',
  });
  assert.equal(await page.locator('#sidebar-draft .mdc-attachment-tile').count(), 2);
  assert.match(
    await page.locator('#sidebar-draft [role="alert"]').textContent(),
    /synthetic storage failure/,
  );
  const sentBeforeCancel = await page.evaluate(() => window.sent.length);
  await page.locator('#sidebar-draft [data-act="cancel"]').click();
  assert.equal(await page.locator('#sidebar-draft .mdc-attachment-tile').count(), 0);
  assert.equal(await page.evaluate(() => window.sent.length), sentBeforeCancel);
  assert.deepEqual(errors, []);
  if (process.env.SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  }
  console.log(
    'PASS: safe Markdown, raw edit round trip, fixed code toolbar, copy payload, multi-image ordering, image-only submission, failure retention, cancellation.',
  );
} finally {
  await browser.close();
}
