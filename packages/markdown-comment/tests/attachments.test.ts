import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { attachmentPath, prepareAttachments, MAX_ATTACHMENT_SIZE } from '../src/attachments';
import { loadDoc, saveDoc, migrateDoc } from '../src/storage';
import type { StoredDocument } from '../src/types';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=',
  'base64',
);
const input = (name = 'test.png') => ({ name, mime: 'image/png', data: png.toString('base64') });
function fixture(t: { after: (fn: () => void) => void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-attachments-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('attachment order and raw Markdown survive persistence and document migration', (t) => {
  const root = fixture(t);
  const batch = prepareAttachments(root, [input('first.png'), input('second.png')]);
  const raw = '  **bold**\n\n```ts\nconst html = "<script>";\n```\n';
  const doc: StoredDocument = {
    version: 1,
    threads: [
      {
        id: 't',
        status: 'open',
        anchor: {
          kind: 'document',
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: 0,
          quote: '',
          before: '',
          after: '',
        },
        comments: [{ id: 'c', author: 'user', body: raw, createdAt: '', attachments: batch.attachments }],
      },
    ],
  };
  saveDoc(root, '/synthetic/first.md', doc);
  const reordered = prepareAttachments(
    root,
    batch.attachments
      .slice()
      .reverse()
      .map(({ id }) => ({ id })),
    batch.attachments,
  );
  doc.threads[0].comments[0].attachments = reordered.attachments;
  saveDoc(root, '/synthetic/first.md', doc);
  migrateDoc(root, '/synthetic/first.md', '/synthetic/moved.md');
  const comment = loadDoc(root, '/synthetic/moved.md').threads[0].comments[0];
  assert.equal(comment.body, raw);
  assert.deepEqual(
    comment.attachments?.map((a) => a.name),
    ['second.png', 'first.png'],
  );
  assert.ok(comment.attachments?.every((a) => fs.readFileSync(attachmentPath(root, a.id)).equals(png)));
});

test('omitted edit retains attachments, empty array removes references only, cancellation writes nothing', (t) => {
  const root = fixture(t);
  const batch = prepareAttachments(root, [input()]);
  const before = fs.readdirSync(path.join(root, 'attachments'));
  assert.deepEqual(prepareAttachments(root, undefined, batch.attachments).attachments, batch.attachments);
  assert.deepEqual(prepareAttachments(root, [], batch.attachments).attachments, []);
  assert.deepEqual(fs.readdirSync(path.join(root, 'attachments')), before);
  const draft = [input('cancelled.png')];
  draft.splice(0); // A cancelled browser draft never calls prepareAttachments.
  assert.deepEqual(fs.readdirSync(path.join(root, 'attachments')), before);
});

test('failed commit rollback removes new bytes only, preserving retained originals', (t) => {
  const root = fixture(t);
  const old = prepareAttachments(root, [input('old.png')]);
  const batch = prepareAttachments(root, [{ id: old.attachments[0].id }, input('new.png')], old.attachments);
  // Force an index error before the document's atomic commit.
  fs.mkdirSync(path.join(root, 'index.json'));
  assert.throws(() =>
    saveDoc(root, '/synthetic/fail.md', {
      version: 1,
      threads: [
        {
          id: 'x',
          status: 'open',
          anchor: {
            kind: 'document',
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            quote: '',
            before: '',
            after: '',
          },
          comments: [{ id: 'c', author: 'user', body: '', createdAt: '', attachments: batch.attachments }],
        },
      ],
    }),
  );
  batch.rollback();
  assert.deepEqual(fs.readdirSync(path.join(root, 'attachments')), [old.attachments[0].id]);
  assert.equal(loadDoc(root, '/synthetic/fail.md').threads.length, 0);
});

test('validates count, signatures, declared type, base64 and size before writes', (t) => {
  const root = fixture(t);
  for (const invalid of [
    Array.from({ length: 11 }, () => input()),
    [{ ...input(), mime: 'image/svg+xml' }],
    [{ ...input(), data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }],
    [{ ...input(), data: '***=' }],
    [{ ...input(), data: Buffer.alloc(MAX_ATTACHMENT_SIZE + 1).toString('base64') }],
    [input(), { ...input(), data: 'AAAA' }],
    [{ ...input(), name: 'bad\u0000.png' }],
    [{ id: '../../private' }],
  ]) {
    assert.throws(() => prepareAttachments(root, invalid));
  }
  assert.equal(fs.existsSync(path.join(root, 'attachments')), false);
  const large = Buffer.alloc(MAX_ATTACHMENT_SIZE);
  png.copy(large);
  assert.throws(() =>
    prepareAttachments(
      root,
      Array.from({ length: 4 }, () => ({ ...input(), data: large.toString('base64') })),
    ),
  );
  assert.equal(fs.existsSync(path.join(root, 'attachments')), false);
});

test('IDs cannot be borrowed from another comment or duplicated', (t) => {
  const root = fixture(t);
  const batch = prepareAttachments(root, [input()]);
  const { id } = batch.attachments[0];
  assert.throws(() => prepareAttachments(root, [{ id }]));
  assert.throws(() => prepareAttachments(root, [{ id }, { id }], batch.attachments));
});

test('names cannot control paths; rejects traversal and symlink reads/writes', (t) => {
  const root = fixture(t);
  const batch = prepareAttachments(root, [input('../../outside.png')]);
  assert.equal(fs.existsSync(path.join(root, 'outside.png')), false);
  assert.equal(path.dirname(attachmentPath(root, batch.attachments[0].id)), path.join(root, 'attachments'));
  assert.throws(() => attachmentPath(root, '../index.json'));
  const file = attachmentPath(root, batch.attachments[0].id);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(root, 'outside'), file);
  assert.throws(() => attachmentPath(root, batch.attachments[0].id));
  fs.rmSync(path.join(root, 'attachments'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'attachments'));
  assert.throws(() => prepareAttachments(root, [input()]));
  assert.deepEqual(fs.readdirSync(path.join(root, 'outside')), []);
});

test('a partial file-write failure is cleaned up', (t) => {
  const root = fixture(t);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', ((
    file: Parameters<typeof fs.writeFileSync>[0],
    data: Parameters<typeof fs.writeFileSync>[1],
  ) => {
    if (typeof file === 'number') {
      write(file, Buffer.from([1]));
      throw new Error('Synthetic disk full');
    }
    return write(file, data);
  }) as typeof fs.writeFileSync);
  assert.throws(() => prepareAttachments(root, [input()]), /Synthetic disk full/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'attachments')), []);
});

test('missing original metadata can be retained without blocking a body edit', (t) => {
  const root = fixture(t);
  const batch = prepareAttachments(root, [input()]);
  fs.unlinkSync(attachmentPath(root, batch.attachments[0].id));
  const retained = prepareAttachments(root, [{ id: batch.attachments[0].id }], batch.attachments);
  assert.deepEqual(retained.attachments, batch.attachments);
});
