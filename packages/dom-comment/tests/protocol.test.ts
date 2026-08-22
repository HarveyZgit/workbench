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
