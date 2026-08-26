import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  encodeFrame,
  handleRequest,
  tryDecodeFrames,
  type HostRequest,
} from '../src/native-host/protocol.js';
import { writeSession } from '../src/storage/index.js';

const TAB_A = 7;
const TAB_B = 8;
const PARTIAL_BYTES = 3;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-proto-'));
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

function create(dir: string, tabId = TAB_A) {
  writeSession(dir, 'S1');
  return handleRequest(
    {
      id: 'c',
      op: 'createThread',
      tabId,
      url: 'https://ex.com/app',
      title: 'App',
      captured,
      body: '按钮',
      screenshotPngBase64: Buffer.from('png').toString('base64'),
    },
    dir,
  );
}

test('ping hello beginSession loadTab', () => {
  const dir = tmpDir();
  assert.equal(handleRequest({ id: 'p', op: 'ping' }, dir).ok, true);
  const hello = handleRequest({ id: 'h', op: 'hello' }, dir);
  assert.equal(hello.ok, true);
  if (hello.ok) {
    assert.ok(hello.sessionId);
  }
  const begun = handleRequest({ id: 'b', op: 'beginSession', sessionId: 'SID' }, dir);
  assert.deepEqual(begun, { id: 'b', ok: true, sessionId: 'SID' });
  const missing = handleRequest({ id: 'b0', op: 'beginSession', sessionId: '' }, dir);
  assert.equal(missing.ok, false);
  const load = handleRequest({ id: 'l', op: 'loadTab', tabId: TAB_A }, dir);
  assert.equal(load.ok, true);
  const badTab = handleRequest({ id: 'l0', op: 'loadTab', tabId: -1 }, dir);
  assert.equal(badTab.ok, false);
});

test('reclaim reply edit resolve deleteThread', () => {
  const dir = tmpDir();
  const created = create(dir);
  assert.equal(created.ok, true);
  if (!created.ok || !created.thread) {
    return;
  }
  const { id } = created.thread;
  assert.equal(handleRequest({ id: 'r', op: 'reclaimTabs', tabIds: [TAB_A], sessionId: 'S1' }, dir).ok, true);
  const replied = handleRequest({ id: 'a', op: 'reply', threadId: id, body: '已看', author: 'agent' }, dir);
  assert.equal(replied.ok, true);
  const edited = handleRequest(
    { id: 'e', op: 'editComment', threadId: id, commentId: created.thread.comments[0].id, body: '改了' },
    dir,
  );
  assert.equal(edited.ok, true);
  assert.equal(handleRequest({ id: 's', op: 'resolve', threadId: id }, dir).ok, true);
  assert.equal(
    handleRequest(
      {
        id: 'u',
        op: 'updateRelocate',
        tabId: TAB_A,
        url: 'https://ex.com/app',
        updates: [{ threadId: id, state: 'located' }],
      },
      dir,
    ).ok,
    true,
  );
  assert.equal(handleRequest({ id: 'd', op: 'deleteThread', threadId: id }, dir).ok, true);
  assert.equal(
    handleRequest({ id: 'a2', op: 'reply', threadId: id, body: 'x', author: 'user' }, dir).ok,
    false,
  );
});

test('deleteComment discardPending focusTab and frames', () => {
  const dir = tmpDir();
  const created = create(dir, TAB_B);
  assert.equal(created.ok, true);
  if (!created.ok || !created.thread) {
    return;
  }
  const cid = created.thread.comments[0].id;
  const deleted = handleRequest(
    { id: 'dc', op: 'deleteComment', threadId: created.thread.id, commentId: cid },
    dir,
  );
  assert.equal(deleted.ok, true);
  create(dir, TAB_B);
  assert.equal(handleRequest({ id: 'dp', op: 'discardPending', tabId: TAB_B }, dir).ok, true);
  const focus = handleRequest({ id: 'f', op: 'focusTab', tabId: TAB_B }, dir);
  assert.equal(focus.ok, false);
  const frame = encodeFrame({ hi: 1 });
  const decoded = tryDecodeFrames(frame);
  assert.deepEqual(decoded.messages[0], { hi: 1 });
  const partial = tryDecodeFrames(frame.subarray(0, PARTIAL_BYTES));
  assert.equal(partial.messages.length, 0);
  const unknownReq: HostRequest = { id: 'z', op: 'nope' } as unknown as HostRequest;
  assert.equal(handleRequest(unknownReq, dir).ok, false);
  const badShot = handleRequest({ id: 's', op: 'loadScreenshot', tabId: TAB_B, rel: '../x.png' }, dir);
  assert.equal(badShot.ok, false);
});
