import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../src/native-host/protocol.js';
import { writeSession } from '../src/storage/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src/cli.ts');
const tsx = path.join(root, 'node_modules/.bin/tsx');

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(tsx, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('help and unknown command', () => {
  const help = run(['help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /dom-comment list/);
  assert.match(help.stdout, /dom-comment install-skill/);
  assert.doesNotMatch(help.stdout, /dom-comment install \[--target/);
  const unknown = run(['wat']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /未知命令/);
});

test('install is gone and hints at install-skill', () => {
  const renamed = run(['install']);
  assert.notEqual(renamed.status, 0);
  assert.match(renamed.stderr, /install-skill/);
  assert.match(renamed.stderr, /已换成/);
  const withTarget = run(['install', '--target', '/tmp/skills']);
  assert.notEqual(withTarget.status, 0);
  assert.match(withTarget.stderr, /已换成/);
});

test('list reply resolve against a temp store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-cli-'));
  writeSession(dir, 'S1');
  const created = handleRequest(
    {
      id: '1',
      op: 'createThread',
      tabId: 99,
      url: 'https://ex.com/app',
      title: 'App',
      captured: {
        kind: 'element',
        css: 'button',
        xpath: '//button',
        tagName: 'button',
        quote: '保存',
        before: '',
        after: '',
        outerHTML: '<button>保存</button>',
        textContent: '保存',
      },
      body: '太大',
      screenshotPngBase64: '',
    },
    dir,
  );
  assert.equal(created.ok, true);
  if (!created.ok || !created.thread) {
    return;
  }
  const env = { DOM_COMMENT_STORAGE_DIR: dir };
  const listed = run(['list', '--tab', '99', '--json'], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /太大/);
  const batches = run(['list', '--open'], env);
  assert.equal(batches.status, 0);
  const named = run(['list', '--name-only'], env);
  assert.equal(named.status, 0);
  const replied = run(['reply', created.thread.id, 'agent-ok'], env);
  assert.equal(replied.status, 0, replied.stderr);
  const resolved = run(['resolve', created.thread.id], env);
  assert.equal(resolved.status, 0, resolved.stderr);
  const empty = run(['list'], env);
  assert.equal(empty.status, 0);
  const badTab = run(['list', '--tab', 'nope'], env);
  assert.notEqual(badTab.status, 0);
  const ext = run(['extension']);
  assert.ok(ext.status === 0 || /找不到扩展/.test(ext.stderr));
});
