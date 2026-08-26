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
  readStorageDir,
  saveDoc,
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
