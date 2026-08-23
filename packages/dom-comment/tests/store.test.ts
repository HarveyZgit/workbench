import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildAnchor } from '../src/core/anchor.js';
import {
  createThread,
  deleteComment,
  discardPending,
  editComment,
  reply,
  updateRelocate,
} from '../src/core/ops.js';
import type { CapturedElement } from '../src/core/types.js';
import {
  currentSession,
  findThread,
  loadTab,
  prepareTab,
  reclaimLiveTabs,
  saveTab,
  screenshotRelPath,
  writeSession,
} from '../src/storage/index.js';
import { main } from '../src/cli/cli.js';

const TAB_PRIMARY = 1847;
const TAB_SMALL = 9;
const TAB_CLI = 42;
const SHORT_ID_LEN = 8;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-'));
}

function capture(): CapturedElement {
  return {
    kind: 'element',
    css: 'button.save',
    xpath: '/html/body/button',
    tagName: 'button',
    quote: '保存更改',
    before: '前',
    after: '后',
    outerHTML: '<button>保存更改</button>',
    textContent: '保存更改',
  };
}

function capturedCreate(dir: string, tabId: number, url: string, body: string) {
  const tab = prepareTab(dir, tabId);
  const anchor = buildAnchor(capture(), '设置');
  const { thread } = createThread(tab, url, '设置', anchor, body, screenshotRelPath(url, 'pending'));
  thread.screenshot = screenshotRelPath(url, thread.id);
  saveTab(dir, tab);
  return { tab, thread };
}

test('missing file create then reload', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const { thread } = capturedCreate(dir, TAB_PRIMARY, 'https://ex.com/app', '文案太长');
  const loaded = loadTab(dir, TAB_PRIMARY);
  assert.equal(loaded.sessionId, 'S1');
  assert.equal(loaded.pages['https://ex.com/app'].threads[0].id, thread.id);
  assert.equal(loaded.pages['https://ex.com/app'].title, '设置');
});

test('reply keeps screenshot relocateStatus title and other pages', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const { thread } = capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '第一页');
  const tab = loadTab(dir, TAB_SMALL);
  tab.pages['https://ex.com/a'].threads[0].relocateStatus = {
    state: 'located',
    checkedAt: '2026-01-01T00:00:00.000Z',
  };
  const other = buildAnchor(capture(), 'B');
  createThread(tab, 'https://ex.com/b', 'B', other, '第二页', '');
  saveTab(dir, tab);
  const again = loadTab(dir, TAB_SMALL);
  reply(again, thread.id, { author: 'agent', body: '已改' });
  saveTab(dir, again);
  const final = loadTab(dir, TAB_SMALL);
  const t = final.pages['https://ex.com/a'].threads[0];
  assert.equal(t.screenshot.endsWith(`${thread.id}.png`), true);
  assert.equal(t.relocateStatus?.state, 'located');
  assert.equal(final.pages['https://ex.com/a'].title, '设置');
  assert.equal(final.pages['https://ex.com/b'].threads.length, 1);
  assert.equal(t.comments[1].author, 'agent');
});

test('session rotation archives old tab file', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  capturedCreate(dir, TAB_PRIMARY, 'https://ex.com/old', '旧会话');
  writeSession(dir, 'S2');
  const tab = prepareTab(dir, TAB_PRIMARY, 'S2');
  assert.equal(Object.keys(tab.pages).length, 0);
  const anchor = buildAnchor(capture(), '新');
  createThread(tab, 'https://ex.com/new', '新', anchor, '新会话', '');
  saveTab(dir, tab);
  assert.equal(fs.existsSync(path.join(dir, '1847.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '1847.json'), 'utf8')).sessionId, 'S2');
  const archived = path.join(dir, 'archive', 'S1-1847.json');
  assert.equal(fs.existsSync(archived), true);
  assert.equal(JSON.parse(fs.readFileSync(archived, 'utf8')).pages['https://ex.com/old'].threads.length, 1);
});

test('reclaimLiveTabs merges archives back into the live tab', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  capturedCreate(dir, TAB_PRIMARY, 'https://ex.com/old', '第一轮');
  writeSession(dir, 'S2');
  const second = prepareTab(dir, TAB_PRIMARY, 'S2');
  const anchor = buildAnchor(capture(), '新');
  createThread(second, 'https://ex.com/old', '新', anchor, '第二轮', '');
  saveTab(dir, second);
  assert.equal(fs.existsSync(path.join(dir, 'archive', 'S1-1847.json')), true);
  writeSession(dir, 'S2');
  const added = reclaimLiveTabs(dir, [TAB_PRIMARY], 'S2');
  assert.equal(added >= 1, true);
  const loaded = loadTab(dir, TAB_PRIMARY);
  assert.equal(loaded.sessionId, 'S2');
  const bodies = loaded.pages['https://ex.com/old'].threads.flatMap((t) => t.comments.map((c) => c.body));
  assert.equal(bodies.includes('第一轮'), true);
  assert.equal(bodies.includes('第二轮'), true);
  assert.equal(fs.existsSync(path.join(dir, 'archive', 'S1-1847.json')), false);
});

test('empty body is rejected', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const tab = prepareTab(dir, 1);
  const anchor = buildAnchor(capture(), 't');
  assert.throws(() => createThread(tab, 'https://ex.com/', 't', anchor, '   ', ''), /empty body/);
});

function withStdout(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

test('CLI list --tab and reply by short id', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const prev = process.env.DOM_COMMENT_STORAGE_DIR;
  process.env.DOM_COMMENT_STORAGE_DIR = dir;
  const { thread } = capturedCreate(dir, TAB_CLI, 'https://ex.com/app', '文案太长');
  try {
    const text = withStdout(() => main(['list', '--tab', String(TAB_CLI)]));
    assert.match(text, new RegExp(`tab ${TAB_CLI}`));
    assert.match(text, /\[元素\]/);
    assert.match(text, /文案太长/);
    main(['reply', thread.id.slice(0, SHORT_ID_LEN), '已改成保存']);
    const hit = findThread(dir, thread.id);
    assert.equal(hit?.thread.comments[1].body, '已改成保存');
  } finally {
    if (prev === undefined) {
      delete process.env.DOM_COMMENT_STORAGE_DIR;
    } else {
      process.env.DOM_COMMENT_STORAGE_DIR = prev;
    }
  }
});

test('create is immediately listable', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const prev = process.env.DOM_COMMENT_STORAGE_DIR;
  process.env.DOM_COMMENT_STORAGE_DIR = dir;
  capturedCreate(dir, TAB_CLI, 'https://ex.com/app', '写完就能看');
  try {
    const tab = loadTab(dir, TAB_CLI);
    assert.equal(tab.pages['https://ex.com/app'].threads[0].visibility, 'published');
    const listed = withStdout(() => main(['list', '--open']));
    assert.match(listed, /写完就能看/);
    assert.match(listed, /tab-42|#/);
  } finally {
    if (prev === undefined) {
      delete process.env.DOM_COMMENT_STORAGE_DIR;
    } else {
      process.env.DOM_COMMENT_STORAGE_DIR = prev;
    }
  }
});

test('discard pending keeps already saved threads', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '先保存');
  const tab = loadTab(dir, TAB_SMALL);
  tab.pages['https://ex.com/a'].threads[0].visibility = 'pending';
  saveTab(dir, tab);
  capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '第二');
  const again = loadTab(dir, TAB_SMALL);
  const { removed } = discardPending(again);
  saveTab(dir, again);
  assert.equal(removed.length, 1);
  const final = loadTab(dir, TAB_SMALL);
  assert.equal(final.pages['https://ex.com/a'].threads.length, 1);
  assert.equal(final.pages['https://ex.com/a'].threads[0].comments[0].body, '第二');
});

test('updateRelocate skips unknown ids and keeps comments', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const { thread } = capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '第一页');
  const tab = loadTab(dir, TAB_SMALL);
  updateRelocate(
    tab,
    [
      { threadId: thread.id, state: 'orphaned' },
      { threadId: 'missing-id', state: 'located' },
    ],
    '2026-01-02T00:00:00.000Z',
  );
  saveTab(dir, tab);
  const final = loadTab(dir, TAB_SMALL);
  assert.equal(final.pages['https://ex.com/a'].threads[0].relocateStatus?.state, 'orphaned');
  assert.equal(final.pages['https://ex.com/a'].threads[0].comments.length, 1);
});

test('deleteComment removes one comment and drops empty thread', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const { thread } = capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '第一页');
  const tab = loadTab(dir, TAB_SMALL);
  reply(tab, thread.id, { author: 'agent', body: '已看' });
  saveTab(dir, tab);
  const afterReply = loadTab(dir, TAB_SMALL);
  const first = afterReply.pages['https://ex.com/a'].threads[0];
  deleteComment(afterReply, first.id, first.comments[1].id);
  saveTab(dir, afterReply);
  const one = loadTab(dir, TAB_SMALL).pages['https://ex.com/a'].threads[0];
  assert.equal(one.comments.length, 1);
  deleteComment(afterReply, first.id, first.comments[0].id);
  saveTab(dir, afterReply);
  const empty = loadTab(dir, TAB_SMALL);
  assert.equal(empty.pages['https://ex.com/a'], undefined);
});

test('editComment updates body', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const { thread } = capturedCreate(dir, TAB_SMALL, 'https://ex.com/a', '第一页');
  const tab = loadTab(dir, TAB_SMALL);
  editComment(tab, thread.id, thread.comments[0].id, '改过了');
  saveTab(dir, tab);
  const final = loadTab(dir, TAB_SMALL);
  assert.equal(final.pages['https://ex.com/a'].threads[0].comments[0].body, '改过了');
});

test('currentSession persists', () => {
  const dir = tmpDir();
  const a = currentSession(dir);
  const b = currentSession(dir);
  assert.equal(a, b);
});
