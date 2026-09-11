import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  documentContentAttempts,
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

function vscodeLocalUri(fsPath: string, href = `vscode-local:${fsPath}`) {
  return { scheme: 'vscode-local' as const, fsPath, toString: () => href };
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

test('vscode-local identity uses fsPath and matches file: of the same path', () => {
  const local = vscodeLocalUri('/Users/z/Notes/a.md', 'vscode-local:/Users/z/Notes/a.md');
  const localAlt = vscodeLocalUri('/Users/z/Notes/a.md', 'vscode-local://Users/z/Notes/a.md');
  const asFile = fileUri('/Users/z/Notes/a.md', 'file:///Users/z/Notes/a.md');
  const other = vscodeLocalUri('/Users/z/Notes/b.md');
  assert.equal(sameDocumentUri(local, localAlt), true);
  assert.equal(sameDocumentUri(local, asFile), true);
  assert.equal(sameDocumentUri(local, other), false);
  assert.equal(documentStorageKey(local), '/Users/z/Notes/a.md');
  assert.equal(documentStorageKey(local), documentStorageKey(asFile));
  assert.equal(implicitFileWorkspaceRoot(local), path.dirname('/Users/z/Notes/a.md'));
  assert.equal(findMatchingDocument([{ uri: local }], asFile)?.uri, local);
});

test('vscode-remote identity stays on toString (authority + path)', () => {
  const a = {
    scheme: 'vscode-remote',
    fsPath: '/home/z/a.md',
    toString: () => 'vscode-remote://ssh-remote+dev/home/z/a.md',
  };
  const b = {
    scheme: 'vscode-remote',
    fsPath: '/home/z/a.md',
    toString: () => 'vscode-remote://ssh-remote+other/home/z/a.md',
  };
  assert.equal(sameDocumentUri(a, a), true);
  assert.equal(sameDocumentUri(a, b), false);
  assert.equal(documentStorageKey(a), a.toString());
  assert.notEqual(documentStorageKey(a), '/home/z/a.md');
});

test('sameFileFsPath does not require the path to exist on this host', () => {
  const mac = '/Users/someone/RemoteInvisible.md';
  assert.equal(sameFileFsPath(mac, mac), true);
  assert.equal(sameFileFsPath(mac, '/Users/someone/Other.md'), false);
});

test('untitled identity is unchanged next to vscode-local', () => {
  const untitled = { scheme: 'untitled', fsPath: '', toString: () => 'untitled:Untitled-1' };
  const local = vscodeLocalUri('/Users/z/Notes/a.md');
  assert.equal(sameDocumentUri(untitled, untitled), true);
  assert.equal(sameDocumentUri(untitled, local), false);
  assert.notEqual(documentStorageKey(untitled), documentStorageKey(local));
});

test('documentContentAttempts prefers original URI and workspace.fs when Node cannot see the path', () => {
  const local = vscodeLocalUri('/Users/z/a.md');
  const steps = documentContentAttempts(local, { nodeCanReadFsPath: false, remoteName: 'ssh-remote' });
  assert.deepEqual(
    steps.map((step) => `${step.type}:${step.via}`),
    ['open:original', 'read:workspace-fs'],
  );
});

test('documentContentAttempts rewrites file: to vscode-local when remote cannot read fsPath', () => {
  const uri = fileUri('/Users/z/a.md');
  const steps = documentContentAttempts(uri, { nodeCanReadFsPath: false, remoteName: 'ssh-remote' });
  assert.deepEqual(
    steps.map((step) => `${step.type}:${step.via}`),
    ['open:original', 'open:vscode-local', 'read:workspace-fs', 'read:workspace-fs-vscode-local'],
  );
});

test('documentContentAttempts keeps Node fs fallback when this host can read the file', () => {
  const uri = fileUri('/tmp/visible.md');
  const steps = documentContentAttempts(uri, { nodeCanReadFsPath: true, remoteName: undefined });
  assert.ok(steps.some((step) => step.type === 'open' && step.via === 'file-uri'));
  assert.ok(steps.some((step) => step.type === 'read' && step.via === 'node-fs'));
  assert.ok(!steps.some((step) => step.via === 'vscode-local' || step.via === 'workspace-fs-vscode-local'));
});

test('untitled content attempts only open the original URI', () => {
  const steps = documentContentAttempts(
    { scheme: 'untitled', fsPath: '' },
    { nodeCanReadFsPath: false, remoteName: 'ssh-remote' },
  );
  assert.deepEqual(steps, [{ type: 'open', via: 'original' }]);
});
