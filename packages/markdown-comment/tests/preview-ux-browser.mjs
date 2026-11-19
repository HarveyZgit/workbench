/** Chromium interaction regression; uses the build and a synthetic VS Code host. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const panel = await readFile(new URL('../src/preview/panel.ts', import.meta.url), 'utf8');
const style = /const STYLE = `([\s\S]*?)`;/u.exec(panel)?.[1];
const body = /<body>([\s\S]*?)<script nonce=/u.exec(panel)?.[1];
assert.ok(style && body);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
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
const commentBody = '| heading | other |\n| --- | --- |\n| card only | note |';
const text =
  '# Outline\n\n| Heading A | Heading B |\n| --- | --- |\n| prefix selected | second suffix |\n\nSecond context\n\nLast context\n\nResolved context';
const makeThread = (id, line, quote, status = 'open', body = 'reply') => ({
  id,
  kind: 'selection',
  status,
  blockStartLine: line,
  blockEndLine: line + 1,
  quote,
  rendered: { quote, before: '', after: '' },
  comments: [{ id: `c-${id}`, author: 'test', body, createdAt: '2026-01-01T00:00:00Z' }],
});
const threads = [
  makeThread('c', 8, 'Last', 'open'),
  makeThread('b', 6, 'Second', 'open'),
  makeThread('a', 4, 'selected', 'open', commentBody),
  makeThread('hidden', 10, 'Resolved', 'resolved'),
];

try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  await page.setContent(`<style>${style}</style>${body}`);
  await page.addStyleTag({ path: fileURLToPath(new URL('../dist/webview.css', import.meta.url)) });
  await page.evaluate(() => {
    window.sent = [];
    window.state = {};
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => window.sent.push(message),
      getState: () => window.state,
      setState: (state) => {
        window.state = state;
      },
    });
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/webview.js', import.meta.url)) });
  const host = (data) =>
    page.evaluate((msg) => window.dispatchEvent(new MessageEvent('message', { data: msg })), data);
  const render = () => host({ type: 'render', text, threads, options });
  await render();

  const dock = page.locator('#mdc-peek-dock');
  const outline = dock.getByRole('button', { name: '展开目录' });
  const sidebar = dock.getByRole('button', { name: '展开评论' });
  const separator = page.getByRole('separator', { name: '调整评论栏宽度' });
  const width = () =>
    page.locator('#sidebar').evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const expectWidth = (expected) =>
    page.waitForFunction(
      (px) => Math.round(document.getElementById('sidebar').getBoundingClientRect().width) === px,
      expected,
    );
  assert.equal(await width(), 320);
  const isFocused = (locator) => locator.evaluate((el) => document.activeElement === el);
  const collapsedPaneHasWidth = (id, target) =>
    page.waitForFunction(
      ({ id, target }) => Math.round(document.getElementById(id).getBoundingClientRect().width) === target,
      { id, target },
    );
  const outlineToggle = page.getByRole('button', { name: '收起目录' });
  const sidebarToggle = page.getByRole('button', { name: '收起评论' });
  await outlineToggle.click();
  await collapsedPaneHasWidth('outline', 0);
  assert.equal(await sidebar.count(), 0);
  assert.ok((await outline.boundingBox()).x < 12);
  assert.equal(await isFocused(outline), true);

  await sidebarToggle.click();
  assert.equal(await separator.count(), 0);
  await expectWidth(0);
  const a = await outline.boundingBox();
  const b = await sidebar.boundingBox();
  assert.ok(a.width <= 24 && b.width <= 24);
  assert.equal(a.y, b.y);
  assert.ok(a.x < 12 && 1320 - (b.x + b.width) < 12);
  assert.equal(await isFocused(sidebar), true);
  await outline.click();
  await collapsedPaneHasWidth('outline', 220);
  assert.equal(await isFocused(outlineToggle), true);
  assert.equal(await outline.count(), 0);
  const right = await sidebar.boundingBox();
  assert.ok(1320 - (right.x + right.width) < 12);
  await sidebar.click();
  await expectWidth(320);
  assert.equal(await isFocused(sidebarToggle), true);

  const split = await separator.boundingBox();
  assert.equal(split.width, 8);
  const dragX = split.x + 1; // Off the painted line, still in the drag hit area.
  await page.mouse.move(dragX, split.y + 130);
  const sashColors = () => separator.evaluate((el) => {
    const line = getComputedStyle(el, '::after');
    const hitArea = getComputedStyle(el);
    return { hitArea: hitArea.backgroundColor, outline: hitArea.outlineStyle, line: line.backgroundColor, width: line.width };
  });
  const hovered = await sashColors();
  assert.equal(hovered.width, '1px');
  assert.equal(hovered.hitArea, 'rgba(0, 0, 0, 0)');
  assert.notEqual(hovered.line, hovered.hitArea);
  assert.equal(hovered.outline, 'none');
  await page.mouse.down();
  await page.mouse.move(dragX - 246, split.y + 130, { steps: 4 });
  assert.deepEqual(await sashColors(), hovered);
  await page.mouse.up();
  await expectWidth(566);
  assert.equal((await page.evaluate(() => window.state)).sidebarWidth, 566);
  await page.setViewportSize({ width: 1010, height: 760 });
  await expectWidth(430);
  assert.equal((await page.evaluate(() => window.state)).sidebarWidth, 566);
  await page.setViewportSize({ width: 1320, height: 760 });
  await expectWidth(566);
  await separator.focus();
  await separator.press('End');
  await expectWidth(640);
  await separator.press('Home');
  await expectWidth(320);

  const active = () => page.locator('#sidebar .mdc-card.active').getAttribute('data-thread-id');
  await page.locator('.mdc-card[data-thread-id="a"] .mdc-card-quote').click();
  assert.equal(await active(), 'a');
  await page.keyboard.press('ArrowUp');
  assert.equal(await active(), 'a');
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(), 'b');
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(), 'c');
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(), 'c'); // no wrap, skips resolved comments in the open filter
  await page.locator('.mdc-card[data-thread-id="c"] textarea').focus();
  await page.keyboard.press('ArrowUp');
  assert.equal(await active(), 'c');
  await page.locator('#content').focus();
  await page.keyboard.press('Shift+ArrowUp');
  assert.equal(await active(), 'c');
  await page.keyboard.press('ArrowUp');
  assert.equal(await active(), 'b');
  await page.locator('.mdc-tab[data-tab="resolved"]').click();
  assert.equal(await page.locator('#sidebar .mdc-card.active').count(), 0);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#sidebar .mdc-card.active').count(), 0);
  await page.locator('.mdc-tab[data-tab="open"]').click();
  assert.equal(await active(), 'b');

  const draftHighlight = () =>
    page.evaluate(() => {
      const fragments = [];
      CSS.highlights.get('mdc-selection-draft')?.forEach((range) => fragments.push(range.toString()));
      return fragments.join('');
    });
  const selectPartialParagraph = () =>
    page
      .locator('#content p')
      .first()
      .evaluate((paragraph) => {
        const node = paragraph.lastChild;
        const range = document.createRange();
        range.setStart(node, 1);
        range.setEnd(node, 4);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
  const normalComment = page.getByRole('button', { name: '💬 评论', exact: true });
  const normalDraft = page.locator('#sidebar #sidebar-draft textarea');
  const normalCancel = page.locator('#sidebar #sidebar-draft button[data-act="cancel"]');
  await selectPartialParagraph();
  await normalComment.click();
  assert.equal(await draftHighlight(), 'con');
  await normalDraft.fill('retryable draft');
  await render();
  assert.equal(await draftHighlight(), 'con');
  await normalDraft.press('Control+Enter');
  const failed = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'createThread'),
  );
  await host({ type: 'commentResult', requestId: failed.requestId, ok: false, error: 'fixture failed' });
  assert.equal(await normalDraft.inputValue(), 'retryable draft');
  assert.equal(await draftHighlight(), 'con');
  await normalDraft.press('Escape');
  assert.equal(await draftHighlight(), '');
  assert.equal(await normalDraft.count(), 0);

  await selectPartialParagraph();
  await normalComment.click();
  assert.equal(await draftHighlight(), 'con');
  await host({ type: 'render', text: text + '\n\nnew paragraph', threads, options });
  assert.equal(await draftHighlight(), '');
  assert.equal(await normalDraft.count(), 1);
  await normalCancel.click();
  await render();
  await page.getByRole('button', { name: '全文评论' }).click();
  assert.equal(await draftHighlight(), '');
  await normalCancel.click();
  assert.equal(await page.locator('#content mark.mdc-hl').count(), 3);

  const previewTable = page.locator('#content .mdc-table-view');
  const launch = previewTable.getByRole('button', { name: '全屏查看表格' });
  await page.mouse.move(2, 600);
  assert.equal(await launch.evaluate((el) => getComputedStyle(el).opacity), '0');
  await previewTable.locator('table').hover();
  assert.equal(await launch.evaluate((el) => getComputedStyle(el).opacity), '1');
  await page.mouse.move(2, 600);
  await launch.focus();
  assert.equal(await launch.evaluate((el) => getComputedStyle(el).opacity), '1');
  await previewTable.locator('table').evaluate((table) => {
    window.originalTable = table;
  });
  await launch.press('Enter');
  const opened = page.getByRole('dialog', { name: '表格' });
  assert.equal(await opened.count(), 1);
  assert.equal(await opened.locator('table').evaluate((table) => table === window.originalTable), true);
  assert.equal(await opened.locator('mark.mdc-hl').count(), 1);
  assert.deepEqual(await opened.boundingBox(), { x: 0, y: 0, width: 1320, height: 760 });
  await page.keyboard.press('ArrowUp');
  assert.equal(await active(), 'b'); // native overlay navigation does not change the current thread
  const selectAcrossCells = () =>
    page.evaluate(() => {
      const [first, last] = document.querySelectorAll('#content dialog[open] tbody td');
      const range = document.createRange();
      range.setStart(first.querySelector('mark').firstChild, 0);
      range.setEnd(last.firstChild, 'second'.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  const selected = () => page.evaluate(() => window.getSelection().getRangeAt(0).toString());
  await selectAcrossCells();
  assert.equal(await selected(), 'selected\nsecond');
  await host({ type: 'threads', threads });
  assert.equal(await selected(), 'selected\nsecond');
  await render();
  assert.equal(await opened.count(), 1);
  assert.equal(await selected(), 'selected\nsecond');
  await page.keyboard.press('Escape');
  assert.equal(await opened.count(), 0);
  assert.equal(await selected(), 'selected\nsecond');
  assert.equal(await launch.evaluate((el) => document.activeElement === el), true);

  await launch.press('Enter');
  await selectAcrossCells();
  await opened.getByRole('button', { name: '💬 评论', exact: true }).click();
  const draft = opened.locator('#sidebar-draft textarea');
  assert.equal(await draftHighlight(), 'selected\nsecond');
  assert.equal(await opened.locator('tr > mark').count(), 0);
  await draft.fill('in fullscreen');
  await render(); // keep the same draft (unsubmitted state and focus) through host updates
  assert.equal(await draft.inputValue(), 'in fullscreen');
  assert.equal(await draftHighlight(), 'selected\nsecond');
  await draft.press('Control+Enter');
  const created = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'createThread'),
  );
  assert.equal(created.selection.quote, 'selected\nsecond');
  assert.equal(created.selection.blockStartLine, 4);
  assert.equal(created.selection.blockEndLine, 5);
  assert.equal(created.text, 'in fullscreen');
  await host({ type: 'commentResult', requestId: created.requestId, ok: true });
  const saved = makeThread('saved-draft', 4, created.selection.quote);
  await host({ type: 'threads', threads: [...threads, saved] });
  assert.equal(await opened.count(), 1);
  assert.equal(await draft.count(), 0);
  assert.equal(await draftHighlight(), '');
  assert.deepEqual(await opened.locator('mark[data-thread-id="saved-draft"]').allTextContents(), [
    'selected',
    'second',
  ]);
  await host({ type: 'threads', threads });
  await selectAcrossCells();
  await opened.getByRole('button', { name: '💬 评论', exact: true }).click();
  await draft.fill('retain on exit');
  await draft.press('Escape');
  assert.equal(await opened.count(), 0);
  assert.equal(await page.locator('#sidebar #sidebar-draft textarea').inputValue(), 'retain on exit');
  assert.equal(await draftHighlight(), 'selected\nsecond');
  await page.locator('#sidebar #sidebar-draft button[data-act="cancel"]').click();
  assert.equal(await draftHighlight(), '');

  await separator.press('End');
  await expectWidth(640);
  const commentTable = page.locator('.mdc-body .mdc-table-view');
  const commentLaunch = commentTable.getByRole('button', { name: '全屏查看表格' });
  await commentTable.locator('th').last().hover();
  const narrowTable = await commentTable.locator('th').last().boundingBox();
  const narrowIcon = await commentLaunch.boundingBox();
  assert.ok(Math.abs(narrowTable.x + narrowTable.width - (narrowIcon.x + narrowIcon.width)) < 20);
  await page.mouse.move(2, 600);
  await commentLaunch.focus();
  assert.equal(await commentLaunch.evaluate((el) => getComputedStyle(el).opacity), '1');
  await page.locator('#content').focus();
  assert.equal(await commentLaunch.evaluate((el) => getComputedStyle(el).opacity), '0');
  await commentLaunch.focus();
  await commentLaunch.press('Enter');
  await opened
    .locator('tbody td')
    .first()
    .evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  assert.equal(await opened.getByRole('button', { name: '💬 评论' }).count(), 0);
  await opened.getByRole('button', { name: '关闭全屏表格' }).click();
  assert.equal(await opened.count(), 0);
  assert.equal(await commentLaunch.evaluate((el) => document.activeElement === el), true);

  const widthToken = 'wide'.repeat(200);
  const longRow = `| ${widthToken} | more |`;
  const wideTable = ['| a | b |', '| --- | --- |', ...Array(50).fill(longRow)].join('\n');
  await host({ type: 'render', text: wideTable, threads: [], options });
  await launch.focus();
  const buttonX = (await launch.boundingBox()).x;
  const inlineScroll = previewTable.locator('.mdc-table-scroll');
  const scroller = await inlineScroll.boundingBox();
  const wideIcon = await launch.boundingBox();
  assert.ok(Math.abs(scroller.x + scroller.width - (wideIcon.x + wideIcon.width)) < 20);
  await inlineScroll.evaluate((el) => {
    el.scrollLeft = 200;
  });
  assert.ok(await inlineScroll.evaluate((el) => el.scrollLeft > 0));
  assert.equal((await launch.boundingBox()).x, buttonX);
  await launch.press('Enter');
  const openScroll = opened.getByRole('region', { name: '表格内容' });
  await openScroll.evaluate((el) => {
    el.scrollLeft = 200;
    el.scrollTop = 200;
  });
  assert.ok(await openScroll.evaluate((el) => el.scrollLeft > 0 && el.scrollTop > 0));
  const closeRect = await opened.getByRole('button', { name: '关闭全屏表格' }).boundingBox();
  assert.ok(closeRect.x + closeRect.width < 1320 && closeRect.y < 15);
  await page.keyboard.press('Escape');
  assert.equal(await opened.count(), 0);
  const disclosureText = [
    '# Disclosure fixture',
    '',
    '<details><summary>Click **label**</summary>',
    '',
    'Inside the disclosure',
    '</details>',
    '',
    '<details open>',
    '<summary>Already open</summary>',
    'Initially visible',
    '</details>',
  ].join('\n');
  await host({ type: 'render', text: disclosureText, threads: [], options: { ...options, html: 'strict' } });
  const disclosure = page.locator('#content details').first();
  const label = disclosure.locator('summary');
  const inside = disclosure.locator('p');
  assert.equal(await inside.isVisible(), false);
  assert.equal(await page.locator('#content details[open] p').isVisible(), true);
  assert.equal(await label.locator('strong').textContent(), 'label');
  await label.click();
  assert.equal(await inside.isVisible(), true);
  await inside.evaluate((paragraph) => {
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 'Inside'.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '💬 评论', exact: true }).click();
  const disclosureDraft = page.locator('#sidebar-draft textarea');
  await disclosureDraft.fill('Disclosure comment');
  await disclosureDraft.press('Control+Enter');
  const disclosureComment = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'createThread'),
  );
  assert.equal(disclosureComment.selection.quote, 'Inside');
  assert.equal(disclosureComment.selection.blockStartLine, 4);
  assert.equal(disclosureComment.selection.blockEndLine, 5);
  await host({ type: 'commentResult', requestId: disclosureComment.requestId, ok: true });
  await label.click();
  assert.equal(await inside.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: left/right dock, exact draft highlighting, sidebar resizing and clamping, visible-thread keys, fullscreen source and comment tables, selection/draft refresh fullscreen submission, and native disclosure toggling and selection.',
  );
} finally {
  await browser.close();
}
