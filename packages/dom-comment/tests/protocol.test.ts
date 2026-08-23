import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { handleRequest } from '../src/native-host/protocol.js';
import { loadTab, writeSession } from '../src/storage/index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-host-'));
}

const captured = {
  kind: 'element' as const,
  css: 'button.save',
  xpath: '/html/body/button',
  tagName: 'button',
  quote: '保存',
  before: '',
  after: '',
  outerHTML: '<button>保存</button>',
  textContent: '保存',
};

test('createThread writes png and json', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const png = Buffer.from('png-bytes');
  const res = handleRequest(
    {
      id: '1',
      op: 'createThread',
      tabId: 7,
      url: 'https://ex.com/app?utm_source=x',
      title: 'App',
      captured,
      body: '按钮太大',
      screenshotPngBase64: png.toString('base64'),
    },
    dir,
  );
  assert.equal(res.ok, true);
  if (!res.ok) {
    return;
  }
  const tab = loadTab(dir, 7);
  const page = tab.pages['https://ex.com/app'];
  assert.ok(page);
  assert.equal(page.threads[0].comments[0].body, '按钮太大');
  assert.equal(fs.existsSync(path.join(dir, '7', page.threads[0].screenshot)), true);
});

test('createThread is immediately stored', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const created = handleRequest(
    {
      id: 'p1',
      op: 'createThread',
      tabId: 7,
      url: 'https://ex.com/app',
      title: 'App',
      captured,
      body: '草稿',
      screenshotPngBase64: '',
    },
    dir,
  );
  assert.equal(created.ok, true);
  const tab = loadTab(dir, 7);
  assert.equal(tab.pages['https://ex.com/app'].threads[0].visibility, 'published');
  const empty = handleRequest({ id: 'p0', op: 'publishTab', tabId: 8 }, dir);
  assert.equal(empty.ok, false);
});

test('loadScreenshot returns png bytes', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const png = Buffer.from('png-bytes');
  const created = handleRequest(
    {
      id: 's1',
      op: 'createThread',
      tabId: 7,
      url: 'https://ex.com/app',
      title: 'App',
      captured,
      body: '看图',
      screenshotPngBase64: png.toString('base64'),
    },
    dir,
  );
  assert.equal(created.ok, true);
  const tab = loadTab(dir, 7);
  const rel = tab.pages['https://ex.com/app'].threads[0].screenshot;
  const shot = handleRequest({ id: 's2', op: 'loadScreenshot', tabId: 7, rel }, dir);
  assert.equal(shot.ok, true);
  if (!shot.ok) {
    return;
  }
  assert.equal(shot.pngBase64, png.toString('base64'));
  const bad = handleRequest({ id: 's3', op: 'loadScreenshot', tabId: 7, rel: '../secret.png' }, dir);
  assert.equal(bad.ok, false);
});

test('empty body fails', () => {
  const dir = tmpDir();
  writeSession(dir, 'S1');
  const res = handleRequest(
    {
      id: '2',
      op: 'createThread',
      tabId: 7,
      url: 'https://ex.com/',
      title: 'x',
      captured,
      body: '  ',
      screenshotPngBase64: '',
    },
    dir,
  );
  assert.equal(res.ok, false);
});
