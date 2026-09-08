import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  docFile,
  fileHash,
  findThread,
  listAll,
  loadDoc,
  migrateDoc,
  readStorageDir,
  saveDoc,
  resolveDocKey,
  storageKey,
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
  assert.equal(storageKey({ scheme: 'file', fsPath: '/tmp/a.md', toString: () => 'file:///tmp/a.md' }), '/tmp/a.md');
  assert.equal(
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }),
    'untitled:Untitled-1',
  );
  assert.notEqual(
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }),
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-2' }),
  );
  // 空 fsPath 绝不能作为 untitled 键（会互相撞车）。
  assert.notEqual(
    storageKey({ scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' }),
    '',
  );
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
  assert.equal(listAll(dir).map((x) => x.path).join(','), to);
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
  const ids = loadDoc(dir, to).threads.map((t) => t.id).sort();
  assert.deepEqual(ids, [
    'cccccccc-3333-4333-8333-cccccccccccc',
    'dddddddd-4444-4444-8444-dddddddddddd',
  ]);
  assert.equal(loadDoc(dir, to).threads.find((t) => t.id.startsWith('cccccccc'))?.anchor.quote, 'newer');
});

test('findThread prefers exact id and rejects ambiguous prefixes', () => {
  const dir = tmp();
  saveDoc(dir, '/tmp/a.md', {
    version: 1,
    threads: [thread('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'), thread('aaaaaaab-1111-4111-8111-bbbbbbbbbbbb')],
  });
  assert.equal(findThread(dir, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')?.thread.id.startsWith('aaaaaaaa'), true);
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
