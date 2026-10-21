/** Synthetic DOM integration check. Build first, then run with JSDOM_MODULE pointing
 * to an installed jsdom module. This verifies behavior, not layout or VS Code E2E. */
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
const sent = [];
let copied;
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
Object.defineProperty(window.navigator, 'clipboard', {
  value: {
    writeText: (text) => {
      copied = text;
      return Promise.resolve();
    },
  },
});
const query = (selector) => {
  const result = document.querySelector(selector);
  assert.ok(result, selector);
  return result;
};
const click = (selector) => query(selector).click();
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
const raw = '  **bold**\n\n# Heading\n\n[link](https://example.com "title")\n\n```txt\n  raw\n```\n';
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
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);
const selectFiles = async (selector, names) => {
  const picker = query(selector);
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: names.map((name) => new window.File([image], name, { type: 'image/png' })),
  });
  picker.dispatchEvent(new window.Event('change'));
  await tick();
};
try {
  window.eval(await readFile(path.join(packageRoot, 'dist/webview.js'), 'utf8'));
  assert.equal(sent[0].type, 'ready');
  host({
    type: 'render',
    text: '# Heading\n\n```txt\nlong code\n```',
    threads,
    options,
    diff: {
      baseline: 'saved',
      changes: { added: [], modified: [{ startLine: 2, endLine: 5 }], deleted: [] },
    },
  });
  await tick();
  assert.equal(query('.mdc-body strong').textContent, 'bold');
  assert.equal(
    document.querySelector('.mdc-body script, .mdc-body [onerror], .mdc-body a[href^="javascript:"]'),
    null,
  );
  assert.equal(window.xss, undefined);
  assert.ok(query('#content .mdc-code-block').matches('.mdc-source-block.mdc-diff-modified[data-line="2"]'));
  assert.equal(document.querySelector('#content pre button'), null);
  assert.equal(query('#content .mdc-code-language').textContent, 'txt');
  assert.equal(query('.mdc-body .mdc-code-language').textContent, 'txt');
  click('#content .mdc-code-copy');
  await tick();
  assert.equal(copied, 'long code\n');
  click('[data-comment-id="comment-1"] [data-act="editComment"]');
  assert.equal(query('.mdc-edit-input').value, raw);
  host({ type: 'threads', threads });
  assert.equal(query('.mdc-edit-input').value, raw, 'host refresh preserves edit draft');
  click('.mdc-edit [data-act="editSave"]');
  const edit = sent.findLast((message) => message.type === 'editComment');
  assert.equal(edit.text, raw);
  host({ type: 'commentResult', requestId: edit.requestId, ok: false, error: 'synthetic write failure' });
  assert.equal(query('.mdc-edit-input').value, raw);
  assert.equal(query('.mdc-edit-input').disabled, false);
  click('.mdc-edit [data-act="editCancel"]');
  assert.equal(document.querySelector('.mdc-edit'), null);

  click('#mdc-add-doc');
  await selectFiles('#sidebar-draft input[type="file"]', ['first.png', 'second.png', 'third.png']);
  assert.equal(document.querySelectorAll('#sidebar-draft .mdc-attachment-tile').length, 3);
  click('#sidebar-draft button[aria-label="前移 third.png"]');
  click('#sidebar-draft button[aria-label="删除 first.png"]');
  const docDraft = query('#sidebar-draft .mdc-draft');
  host({ type: 'render', text: '# Source changed while composing', threads, options });
  await tick();
  assert.equal(query('#sidebar-draft .mdc-draft'), docDraft, 'source render preserves document draft');
  assert.equal(document.querySelectorAll('#sidebar-draft .mdc-attachment-tile').length, 2);
  click('#sidebar-draft [data-act="submit"]');
  const pendingDraft = query('#sidebar-draft .mdc-draft');
  query('.mdc-draft-input').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  click('#mdc-add-doc');
  assert.equal(
    query('#sidebar-draft .mdc-draft'),
    pendingDraft,
    'pending submission cannot cancel or replace draft',
  );
  const submit = sent.findLast((message) => message.type === 'createDocThread');
  assert.equal(submit.text, '');
  assert.deepEqual(
    Array.from(submit.attachments, (attachment) => attachment.name),
    ['third.png', 'second.png'],
  );
  host({ type: 'commentResult', requestId: submit.requestId, ok: false, error: 'synthetic storage failure' });
  assert.equal(document.querySelectorAll('#sidebar-draft .mdc-attachment-tile').length, 2);
  assert.match(query('#sidebar-draft [role="alert"]').textContent, /synthetic storage failure/);
  const beforeCancel = sent.length;
  click('#sidebar-draft [data-act="cancel"]');
  assert.equal(document.querySelector('#sidebar-draft .mdc-draft'), null);
  assert.equal(sent.length, beforeCancel);

  click('#mdc-add-doc');
  assert.ok(query('#sidebar-draft .mdc-draft'), 'failed response allows opening another draft');
  click('#sidebar-draft [data-act="cancel"]');

  const range = document.createRange();
  range.selectNodeContents(query('#content h1'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await tick();
  Array.from(document.querySelectorAll('body > button'))
    .find((button) => button.textContent === '💬 评论')
    .click();
  query('.mdc-draft-input').value = 'selection draft retained';
  await selectFiles('#sidebar-draft input[type="file"]', ['selection.png']);
  const selectionDraft = query('#sidebar-draft .mdc-draft');
  host({ type: 'render', text: '# Source changes again', threads, options });
  await tick();
  assert.equal(query('#sidebar-draft .mdc-draft'), selectionDraft);
  assert.equal(query('.mdc-draft-input').value, 'selection draft retained');
  assert.equal(document.querySelectorAll('#sidebar-draft .mdc-attachment-tile').length, 1);
  assert.ok(query('#sidebar-draft [data-act="convertDoc"]'));
  const writesBefore = sent.filter((message) => /^(createThread|createDocThread)$/.test(message.type)).length;
  click('#sidebar-draft [data-act="submit"]');
  assert.equal(
    sent.filter((message) => /^(createThread|createDocThread)$/.test(message.type)).length,
    writesBefore,
    'stale selection cannot submit',
  );
  click('#sidebar-draft [data-act="convertDoc"]');
  click('#sidebar-draft [data-act="submit"]');
  const converted = sent.findLast((message) => message.type === 'createDocThread');
  assert.equal(converted.text, 'selection draft retained');
  assert.equal(converted.attachments[0].name, 'selection.png');
  host({ type: 'commentResult', requestId: converted.requestId, ok: true });
  assert.equal(document.querySelector('#sidebar-draft .mdc-draft'), null);

  const pendingRange = document.createRange();
  pendingRange.selectNodeContents(query('#content h1'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(pendingRange);
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await tick();
  Array.from(document.querySelectorAll('body > button'))
    .find((button) => button.textContent === '💬 评论')
    .click();
  query('.mdc-draft-input').value = 'pending selection';
  click('#sidebar-draft [data-act="submit"]');
  const pendingSelection = sent.findLast((message) => message.type === 'createThread');
  assert.equal(pendingSelection.text, 'pending selection');
  host({ type: 'render', text: '# Source changes during save', threads, options });
  await tick();
  const convertPending = query('#sidebar-draft [data-act="convertDoc"]');
  assert.equal(convertPending.disabled, true, 'cannot convert selection during pending save');
  convertPending.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(
    document.querySelector('#sidebar-draft [data-act="convertDoc"]'),
    'forced click also respects pending guard',
  );
  host({
    type: 'commentResult',
    requestId: pendingSelection.requestId,
    ok: false,
    error: 'synthetic stale save failure',
  });
  assert.equal(query('#sidebar-draft [data-act="convertDoc"]').disabled, false);
  const staleRetries = sent.filter((message) => message.type === 'createThread').length;
  click('#sidebar-draft [data-act="submit"]');
  assert.equal(
    sent.filter((message) => message.type === 'createThread').length,
    staleRetries,
    'failed stale selection cannot retry old anchor',
  );
  click('#sidebar-draft [data-act="convertDoc"]');
  click('#sidebar-draft [data-act="submit"]');
  const convertedPending = sent.findLast((message) => message.type === 'createDocThread');
  assert.equal(convertedPending.text, 'pending selection');
  host({ type: 'commentResult', requestId: convertedPending.requestId, ok: true });

  const uploadedUri = 'vscode-webview-resource://fixture/uploaded.png';
  const imageThreads = structuredClone(threads);
  imageThreads[0].comments.push({
    id: 'comment-image',
    author: 'user',
    body: '<img src="./raw-local.png" alt="local">',
    createdAt: '2026-01-01T00:00:00Z',
    attachments: [
      { id: 'retained-image', name: 'uploaded.png', mime: 'image/png', size: image.length, uri: uploadedUri },
    ],
  });
  const resourcesStart = sent.length;
  host({ type: 'threads', threads: imageThreads });
  const sources = sent
    .slice(resourcesStart)
    .filter((message) => message.type === 'resolveResources')
    .flatMap((message) => Array.from(message.sources));
  assert.ok(sources.includes('./raw-local.png'), 'safe raw HTML image enters resource resolution');
  assert.ok(!sources.includes(uploadedUri), 'uploaded attachment URI never enters resource resolution');
  assert.equal(query('.mdc-comment-image img').hasAttribute('data-src'), false);
  host({ type: 'threads', threads });

  await selectFiles('.mdc-card-reply input[type="file"]', ['reply.png']);
  query('.mdc-reply').value = '  **reply**\n';
  host({ type: 'threads', threads });
  assert.equal(query('.mdc-reply').value, '  **reply**\n');
  assert.equal(document.querySelectorAll('.mdc-card-reply .mdc-attachment-tile').length, 1);
  click('.mdc-card-reply [data-act="reply"]');
  const reply = sent.findLast((message) => message.type === 'reply');
  assert.equal(reply.text, '  **reply**\n');
  assert.equal(reply.attachments[0].name, 'reply.png');
  host({ type: 'commentResult', requestId: reply.requestId, ok: true });
  assert.equal(query('.mdc-reply').value, '');
  assert.equal(document.querySelectorAll('.mdc-card-reply .mdc-attachment-tile').length, 0);
  const codeThread = {
    ...threads[0],
    id: 'code-anchor',
    kind: 'selection',
    blockStartLine: 0,
    blockEndLine: 3,
    quote: 'txt',
    rendered: { quote: 'txt', before: '', after: '' },
  };
  host({ type: 'render', text: '```\ntxt\n```', threads: [codeThread], options });
  await tick();
  assert.equal(document.querySelector('#content .mdc-code-toolbar mark'), null);
  assert.equal(query('#content pre code mark').textContent, 'txt');
  const codeRange = document.createRange();
  codeRange.selectNodeContents(query('#content pre code'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(codeRange);
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await tick();
  Array.from(document.querySelectorAll('body > button'))
    .find((button) => button.textContent === '💬 评论')
    .click();
  query('.mdc-draft-input').value = 'code selection';
  click('#sidebar-draft [data-act="submit"]');
  const codeSelection = sent.findLast((message) => message.type === 'createThread');
  assert.equal(codeSelection.selection.quote, 'txt');
  assert.equal(codeSelection.selection.before, '');
  assert.equal(codeSelection.selection.after, '\n');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: DOM safe Markdown, raw edit/create/reply lifecycle, draft refresh retention, attachment ordering/removal, image-only submission, failure preservation, cancellation and code-copy structure/payload. Layout remains a browser check.',
  );
} finally {
  window.close();
}
