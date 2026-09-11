import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  documentStorageKey,
  findMatchingDocument,
  implicitFileWorkspaceRoot,
  normalizeFileFsPath,
  readSavedMarkdownText,
  resolveLocalResourcePath,
  sameDocumentUri,
  sameFileFsPath,
} from '../src/document-uri.ts';

function fileUri(fsPath: string, href = `file://${fsPath}`) {
  return { scheme: 'file' as const, fsPath, toString: () => href };
}

test('sameDocumentUri matches saved files by absolute fsPath without a workspace', () => {
  const a = fileUri('/tmp/notes/demo.md', 'file:///tmp/notes/demo.md');
  const b = fileUri('/tmp/notes/demo.md', 'file://localhost/tmp/notes/demo.md');
  assert.equal(sameDocumentUri(a, b), true);
  assert.equal(sameDocumentUri(a, fileUri('/tmp/notes/other.md')), false);
  assert.equal(documentStorageKey(a), '/tmp/notes/demo.md');
  assert.equal(implicitFileWorkspaceRoot(a), path.dirname('/tmp/notes/demo.md'));
  assert.equal(implicitFileWorkspaceRoot({ scheme: 'untitled', fsPath: '' }), undefined);
});

test('untitled identity stays on toString and does not collide on empty fsPath', () => {
  const one = { scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' };
  const two = { scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-2' };
  assert.equal(sameDocumentUri(one, one), true);
  assert.equal(sameDocumentUri(one, two), false);
  assert.notEqual(documentStorageKey(one), documentStorageKey(two));
});

test('findMatchingDocument locates an open file by fsPath when URI strings differ', () => {
  const open = { uri: fileUri('/abs/doc.md', 'file:///abs/doc.md') };
  const query = fileUri('/abs/doc.md', 'file://localhost/abs/doc.md');
  assert.equal(findMatchingDocument([open], query), open);
  assert.equal(findMatchingDocument([open], fileUri('/abs/other.md')), undefined);
});

test('resolveLocalResourcePath does not need workspaceFolders for a saved file', () => {
  const file = '/Users/z/alone/readme.md';
  assert.equal(
    resolveLocalResourcePath('./img.png', file, undefined),
    path.resolve('/Users/z/alone/img.png'),
  );
  assert.equal(
    resolveLocalResourcePath('/assets/logo.png', file, undefined),
    path.resolve('/Users/z/alone/assets/logo.png'),
  );
  assert.equal(
    resolveLocalResourcePath('/assets/logo.png', file, '/workspace/root'),
    path.resolve('/workspace/root/assets/logo.png'),
  );
  assert.equal(resolveLocalResourcePath('./img.png', undefined, undefined), null);
});

test('readSavedMarkdownText only accepts an absolute existing path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-nofolder-'));
  const abs = path.join(dir, 'solo.md');
  fs.writeFileSync(abs, '# Hello\n', 'utf8');
  assert.equal(readSavedMarkdownText(abs), '# Hello\n');
  assert.equal(readSavedMarkdownText('relative.md'), undefined);
  assert.equal(readSavedMarkdownText(path.join(dir, 'missing.md')), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalizeFileFsPath and sameFileFsPath treat equivalent paths as one file', () => {
  assert.equal(normalizeFileFsPath('/tmp/a/../b.md'), path.normalize('/tmp/b.md'));
  assert.equal(sameFileFsPath('/tmp/x.md', '/tmp/x.md'), true);
  assert.equal(sameFileFsPath('/tmp/x.md', '/tmp/y.md'), false);
});
