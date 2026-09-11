import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  docFile,
  ensureUntitledCliId,
  fileHash,
  findThread,
  formatSkillPrompt,
  getCliId,
  listAll,
  loadDoc,
  migrateDoc,
  readStorageDir,
  saveDoc,
  resolveDocKey,
  skillPromptTargetState,
  storageKey,
  untitledCliId,
  writePointer,
} from '../src/storage.ts';
import type { StoredDocument, StoredThread } from '../src/types.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-store-'));
}

function thread(id: string, quote = 'hello'): StoredThread {
  return {
    id,
    status: 'open',
    anchor: {
      kind: 'selection',
      startLine: 0,
      startChar: 0,
      endLine: 0,
      endChar: quote.length,
      quote,
      before: '',
      after: '',
    },
    comments: [{ id: `${id}-c`, author: 'user', body: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }],
  };
}

test('fileHash is stable sha1 of the absolute path', () => {
  const a = fileHash('/tmp/a.md');
  assert.equal(a, fileHash('/tmp/a.md'));
  assert.notEqual(a, fileHash('/tmp/b.md'));
  assert.equal(a.length, 40);
});

test('storageKey keeps file fsPath and stable untitled toString', () => {
  assert.equal(
    storageKey({ scheme: 'file', fsPath: '/tmp/a.md', toString: () => 'file:///tmp/a.md' }),
    '/tmp/a.md',
  );
  assert.equal(
    storageKey({
      scheme: 'vscode-local',
      fsPath: '/Users/z/Notes/a.md',
      toString: () => 'vscode-local:/Users/z/Notes/a.md',
    }),
    '/Users/z/Notes/a.md',
  );
  assert.equal(
    storageKey({
      scheme: 'vscode-remote',
      fsPath: '/home/z/a.md',
      toString: () => 'vscode-remote://ssh-remote+dev/home/z/a.md',
    }),
    'vscode-remote://ssh-remote+dev/home/z/a.md',
  );
  assert.equal(
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }),
    'untitled:Untitled-1',
  );
  assert.notEqual(
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }),
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-2' }),
  );
  // 空 fsPath 绝不能作为 untitled 键（会互相撞车）。
  assert.notEqual(storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }), '');
});

test('loadDoc returns empty document when missing or invalid', () => {
  const dir = tmp();
  const empty = loadDoc(dir, '/tmp/missing.md');
  assert.deepEqual(empty, { version: 1, threads: [] });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(docFile(dir, '/tmp/x.md'), '{"no":"threads"}', 'utf8');
  assert.deepEqual(loadDoc(dir, '/tmp/x.md'), { version: 1, threads: [] });
});

test('saveDoc writes index and deletes empty docs', () => {
  const dir = tmp();
  const file = '/tmp/doc.md';
  const doc: StoredDocument = { version: 1, threads: [thread('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')] };
  saveDoc(dir, file, doc);
  assert.equal(loadDoc(dir, file).threads[0].id, doc.threads[0].id);
  assert.equal(listAll(dir)[0].path, file);
  saveDoc(dir, file, { version: 1, threads: [] });
  assert.equal(listAll(dir).length, 0);
  assert.equal(fs.existsSync(docFile(dir, file)), false);
});

test('migrateDoc moves untitled threads to file key and clears source', () => {
  const dir = tmp();
  const from = 'untitled:Untitled-1';
  const to = '/tmp/saved.md';
  const id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  saveDoc(dir, from, { version: 1, threads: [thread(id, 'draft')] });
  assert.equal(migrateDoc(dir, from, to), true);
  assert.equal(loadDoc(dir, from).threads.length, 0);
  assert.equal(fs.existsSync(docFile(dir, from)), false);
  assert.equal(loadDoc(dir, to).threads[0].id, id);
  assert.equal(
    listAll(dir)
      .map((x) => x.path)
      .join(','),
    to,
  );
  // 幂等：源已空时再迁返回 false。
  assert.equal(migrateDoc(dir, from, to), false);
  assert.equal(loadDoc(dir, to).threads.length, 1);
});

test('migrateDoc merges with existing target threads by id', () => {
  const dir = tmp();
  const from = 'untitled:Untitled-2';
  const to = '/tmp/merged.md';
  saveDoc(dir, to, { version: 1, threads: [thread('cccccccc-3333-4333-8333-cccccccccccc', 'old')] });
  saveDoc(dir, from, {
    version: 1,
    threads: [
      thread('cccccccc-3333-4333-8333-cccccccccccc', 'newer'),
      thread('dddddddd-4444-4444-8444-dddddddddddd', 'extra'),
    ],
  });
  assert.equal(migrateDoc(dir, from, to), true);
  const ids = loadDoc(dir, to)
    .threads.map((t) => t.id)
    .sort();
  assert.deepEqual(ids, ['cccccccc-3333-4333-8333-cccccccccccc', 'dddddddd-4444-4444-8444-dddddddddddd']);
  assert.equal(loadDoc(dir, to).threads.find((t) => t.id.startsWith('cccccccc'))?.anchor.quote, 'newer');
});

test('findThread prefers exact id and rejects ambiguous prefixes', () => {
  const dir = tmp();
  saveDoc(dir, '/tmp/a.md', {
    version: 1,
    threads: [thread('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'), thread('aaaaaaab-1111-4111-8111-bbbbbbbbbbbb')],
  });
  assert.equal(
    findThread(dir, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')?.thread.id.startsWith('aaaaaaaa'),
    true,
  );
  assert.equal(findThread(dir, 'aaaaaaa'), null);
  assert.equal(findThread(dir, 'aaaaaaab')?.thread.id.startsWith('aaaaaaab'), true);
  assert.equal(findThread(dir, 'nope'), null);
});

test('readStorageDir prefers env override then pointer file', () => {
  const dir = tmp();
  const prev = process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  process.env.MARKDOWN_COMMENT_STORAGE_DIR = dir;
  assert.equal(readStorageDir(), dir);
  delete process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  writePointer(dir);
  assert.equal(readStorageDir(), dir);
  if (prev === undefined) {
    delete process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  } else {
    process.env.MARKDOWN_COMMENT_STORAGE_DIR = prev;
  }
});

test('resolveDocKey keeps untitled and absolute keys, resolves relative', () => {
  assert.equal(resolveDocKey('untitled:Untitled-1'), 'untitled:Untitled-1');
  assert.equal(resolveDocKey('/tmp/abs.md'), '/tmp/abs.md');
  const rel = 'docs/note.md';
  assert.equal(resolveDocKey(rel), path.resolve(rel));
  // path.resolve would otherwise turn untitled into a cwd-joined path
  assert.notEqual(resolveDocKey('untitled:Untitled-1'), path.resolve('untitled:Untitled-1'));
});

test('untitled key round-trips via saveDoc/loadDoc and resolveDocKey', () => {
  const dir = tmp();
  const key = 'untitled:Untitled-9';
  const id = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
  saveDoc(dir, key, { version: 1, threads: [thread(id, 'draft text')] });
  const resolved = resolveDocKey(key);
  assert.equal(resolved, key);
  assert.equal(loadDoc(dir, resolved).threads[0].id, id);
  assert.equal(listAll(dir)[0].path, key);
});

test('formatSkillPrompt uses absolute path and quotes spaces', () => {
  assert.equal(formatSkillPrompt('/Users/x/proj/docs/a.md'), '/markdown-comment /Users/x/proj/docs/a.md');
  assert.equal(formatSkillPrompt('/path/with spaces.md'), '/markdown-comment "/path/with spaces.md"');
  assert.equal(formatSkillPrompt('u_deadbeef'), '/markdown-comment u_deadbeef');
});

test('saveDoc assigns stable untitled cliId only when threads exist', () => {
  const dir = tmp();
  const key = 'untitled:Untitled-1';
  const expected = untitledCliId(key);
  assert.match(expected, /^u_[0-9a-f]{8}$/);
  saveDoc(dir, key, { version: 1, threads: [] });
  assert.equal(getCliId(dir, key), undefined);
  assert.equal(listAll(dir).length, 0);

  const id = 'ffffffff-7777-4777-8777-ffffffffffff';
  saveDoc(dir, key, { version: 1, threads: [thread(id, 'first')] });
  assert.equal(getCliId(dir, key), expected);
  assert.equal(listAll(dir)[0].cliId, expected);

  // 再次保存保持同一 cliId
  saveDoc(dir, key, {
    version: 1,
    threads: [thread(id, 'first'), thread('aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa')],
  });
  assert.equal(getCliId(dir, key), expected);

  // 清空后 cliId 随 index 条目清除
  saveDoc(dir, key, { version: 1, threads: [] });
  assert.equal(getCliId(dir, key), undefined);
});

test('resolveDocKey looks up cliId via index', () => {
  const dir = tmp();
  const key = 'untitled:Untitled-42';
  const id = 'bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb';
  saveDoc(dir, key, { version: 1, threads: [thread(id)] });
  const cliId = getCliId(dir, key)!;
  assert.equal(resolveDocKey(cliId, dir), key);
  assert.equal(resolveDocKey(key, dir), key);
  assert.equal(resolveDocKey('/tmp/abs.md', dir), '/tmp/abs.md');
  // 未知 cliId 不 path.resolve
  assert.equal(resolveDocKey('u_00000000', dir), 'u_00000000');
  assert.notEqual(resolveDocKey('u_00000000', dir), path.resolve('u_00000000'));
});

test('skillPromptTargetState disables untitled without cliId', () => {
  const disabled = skillPromptTargetState({ scheme: 'untitled', fsPath: '', cliId: undefined });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.tip, '添加评论后可复制');
  assert.equal(disabled.prompt, undefined);

  const enabledUntitled = skillPromptTargetState({ scheme: 'untitled', fsPath: '', cliId: 'u_abcd1234' });
  assert.equal(enabledUntitled.enabled, true);
  assert.equal(enabledUntitled.prompt, '/markdown-comment u_abcd1234');

  const filePrompt = skillPromptTargetState({
    scheme: 'file',
    fsPath: '/Users/x/proj/docs/a.md',
  });
  assert.equal(filePrompt.enabled, true);
  assert.equal(filePrompt.prompt, '/markdown-comment /Users/x/proj/docs/a.md');

  const spaced = skillPromptTargetState({
    scheme: 'file',
    fsPath: '/path/with spaces.md',
  });
  assert.equal(spaced.prompt, '/markdown-comment "/path/with spaces.md"');

  const vscodeLocal = skillPromptTargetState({
    scheme: 'vscode-local',
    fsPath: '/Users/z/Notes/a.md',
  });
  assert.equal(vscodeLocal.enabled, true);
  assert.equal(vscodeLocal.prompt, '/markdown-comment /Users/z/Notes/a.md');
});

test('migrateDoc clears untitled cliId with source store', () => {
  const dir = tmp();
  const from = 'untitled:Untitled-migrate';
  const to = '/tmp/saved-migrate.md';
  saveDoc(dir, from, { version: 1, threads: [thread('cccccccc-0000-4000-8000-cccccccccccc')] });
  const cliId = getCliId(dir, from);
  assert.ok(cliId);
  assert.equal(migrateDoc(dir, from, to), true);
  assert.equal(getCliId(dir, from), undefined);
  assert.equal(getCliId(dir, to), undefined); // file 键不写 cliId
  assert.equal(resolveDocKey(cliId!, dir), cliId); // 旧 id 不再解析到源
});

test('ensureUntitledCliId backfills legacy index missing cliId', () => {
  const dir = tmp();
  const key = 'untitled:Untitled-legacy';
  const id = 'dddddddd-1111-4111-8111-dddddddddddd';
  // 模拟存量：先用 saveDoc 写入，再剥掉 index 里的 cliId
  saveDoc(dir, key, { version: 1, threads: [thread(id, 'legacy')] });
  const expected = untitledCliId(key);
  assert.equal(getCliId(dir, key), expected);

  const indexPath = path.join(dir, 'index.json');
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<
    string,
    { path: string; updatedAt: string; cliId?: string }
  >;
  const h = fileHash(key);
  delete idx[h].cliId;
  fs.writeFileSync(indexPath, `${JSON.stringify(idx, null, 2)}\n`, 'utf8');
  assert.equal(getCliId(dir, key), undefined);

  // 无评论时仍不分配
  const emptyKey = 'untitled:Untitled-empty';
  assert.equal(ensureUntitledCliId(dir, emptyKey), undefined);
  assert.equal(getCliId(dir, emptyKey), undefined);

  // file 键不回填
  assert.equal(ensureUntitledCliId(dir, '/tmp/file.md'), undefined);

  // 有评论 + 缺 cliId → 回填并持久化
  const backfilled = ensureUntitledCliId(dir, key);
  assert.equal(backfilled, expected);
  assert.equal(getCliId(dir, key), expected);
  // 幂等
  assert.equal(ensureUntitledCliId(dir, key), expected);

  // skillPromptTargetState 随 ensure 结果启用
  const state = skillPromptTargetState({
    scheme: 'untitled',
    fsPath: '',
    cliId: ensureUntitledCliId(dir, key),
  });
  assert.equal(state.enabled, true);
  assert.equal(state.prompt, formatSkillPrompt(expected));

  // 空线程仍 disabled
  const emptyState = skillPromptTargetState({
    scheme: 'untitled',
    fsPath: '',
    cliId: ensureUntitledCliId(dir, emptyKey),
  });
  assert.equal(emptyState.enabled, false);
  assert.equal(emptyState.tip, '添加评论后可复制');
});
