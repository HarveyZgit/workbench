import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  documentStorageKey,
  pickSourceText,
  readSavedMarkdownText,
  SOURCE_UNREADABLE_MESSAGE,
  STORAGE_WRITE_FAILED_MESSAGE,
} from '../src/document-uri.ts';
import {
  createDocumentThread,
  createSelectionThreadFromText,
  persistThread,
} from '../src/preview/selection-thread.ts';
import { loadDoc, saveDoc } from '../src/storage.ts';

test('createSelectionThreadFromText maps a rendered selection without vscode or a workspace', () => {
  const text = 'Hello world\n\nSecond paragraph';
  const result = createSelectionThreadFromText(
    text,
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Hello',
      before: '',
      after: ' world',
      spansMultipleBlocks: false,
    },
    'note from a single-file window',
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.thread.anchor.kind, 'selection');
  assert.equal(result.thread.anchor.quote, 'Hello');
  assert.equal(result.thread.anchor.rendered?.quote, 'Hello');
  assert.equal(result.thread.comments[0].body, 'note from a single-file window');
});

test('selection thread persists under the absolute file fsPath when no folder is open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-sel-'));
  const abs = path.join(dir, 'loose.md');
  const source = 'Pick this word in a folderless window.\n';
  fs.writeFileSync(abs, source, 'utf8');

  const text = readSavedMarkdownText(abs);
  assert.ok(text);
  const created = createSelectionThreadFromText(
    text,
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Pick this word',
      before: '',
      after: ' in a folderless window.',
      spansMultipleBlocks: false,
    },
    'works without workspaceFolders',
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const key = documentStorageKey({
    scheme: 'file',
    fsPath: abs,
    toString: () => `file://${abs}`,
  });
  assert.equal(key, abs);
  assert.ok(path.isAbsolute(key));

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-sel-store-'));
  saveDoc(storage, key, { version: 1, threads: [created.thread] });
  const loaded = loadDoc(storage, key);
  assert.equal(loaded.threads.length, 1);
  assert.equal(loaded.threads[0].anchor.quote, 'Pick this word');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(storage, { recursive: true, force: true });
});

test('vscode-local storage key matches file fsPath so mixed-scheme comments share a store', () => {
  const abs = '/Users/z/Notes/mixed.md';
  const fileKey = documentStorageKey({
    scheme: 'file',
    fsPath: abs,
    toString: () => `file://${abs}`,
  });
  const localKey = documentStorageKey({
    scheme: 'vscode-local',
    fsPath: abs,
    toString: () => `vscode-local:${abs}`,
  });
  assert.equal(fileKey, abs);
  assert.equal(localKey, fileKey);
});

test('createSelectionThreadFromText refuses empty source or empty body', () => {
  const emptySource = createSelectionThreadFromText(
    '',
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'x',
      before: '',
      after: '',
      spansMultipleBlocks: false,
    },
    'note',
  );
  assert.equal(emptySource.ok, false);
  if (!emptySource.ok) {
    assert.equal(emptySource.error, SOURCE_UNREADABLE_MESSAGE);
  }

  const emptyBody = createSelectionThreadFromText(
    'Hello',
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Hello',
      before: '',
      after: '',
      spansMultipleBlocks: false,
    },
    '   ',
  );
  assert.equal(emptyBody.ok, false);
});

test('vscode-remote selection persists under toString key not bare fsPath', () => {
  const remoteUri = {
    scheme: 'vscode-remote',
    fsPath: '/home/z/proj/a.md',
    toString: () => 'vscode-remote://ssh-remote+dev/home/z/proj/a.md',
  };
  const key = documentStorageKey(remoteUri);
  assert.equal(key, remoteUri.toString());
  assert.notEqual(key, remoteUri.fsPath);

  const created = createSelectionThreadFromText(
    'Remote file body for selection.\n',
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Remote file',
      before: '',
      after: ' body for selection.',
      spansMultipleBlocks: false,
    },
    'from remote host',
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-remote-'));
  saveDoc(storage, key, { version: 1, threads: [created.thread] });
  const loaded = loadDoc(storage, key);
  assert.equal(loaded.threads.length, 1);
  // Must not collide with a bare-path key if someone mistakenly used fsPath
  const wrong = loadDoc(storage, remoteUri.fsPath);
  assert.equal(wrong.threads.length, 0);
  fs.rmSync(storage, { recursive: true, force: true });
});

test('file and vscode-local share store across write/load (remote×local mixed use)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-mix-'));
  const abs = path.join(dir, 'local-in-remote.md');
  fs.writeFileSync(abs, 'Shared store phrase here.\n', 'utf8');
  const created = createSelectionThreadFromText(
    fs.readFileSync(abs, 'utf8'),
    {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Shared store',
      before: '',
      after: ' phrase here.',
      spansMultipleBlocks: false,
    },
    'written as vscode-local',
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-mix-store-'));
  const localKey = documentStorageKey({
    scheme: 'vscode-local',
    fsPath: abs,
    toString: () => `vscode-local:${abs}`,
  });
  saveDoc(storage, localKey, { version: 1, threads: [created.thread] });
  const viaFile = loadDoc(
    storage,
    documentStorageKey({ scheme: 'file', fsPath: abs, toString: () => `file://${abs}` }),
  );
  assert.equal(viaFile.threads.length, 1);
  assert.equal(viaFile.threads[0].comments[0].body, 'written as vscode-local');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(storage, { recursive: true, force: true });
});

test('create uses cached snapshot when open/read source is empty (preview replaced the tab)', () => {
  const cached = pickSourceText({
    openText: '',
    readText: undefined,
    cachedText: 'Keep this phrase after the tab closed.\n',
  });
  assert.ok(cached);
  const created = createSelectionThreadFromText(
    cached,
    {
      blockStartLine: 0,
      blockEndLine: 0,
      quote: 'Keep this phrase',
      before: '',
      after: ' after the tab closed.',
      spansMultipleBlocks: false,
    },
    'from cache after Active column replace',
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-cache-'));
  const key = documentStorageKey({
    scheme: 'vscode-local',
    fsPath: '/Users/z/Notes/tab-closed.md',
    toString: () => 'vscode-local:/Users/z/Notes/tab-closed.md',
  });
  const saved = persistThread(storage, key, created.thread);
  assert.equal(saved.ok, true);
  assert.equal(loadDoc(storage, key).threads[0].comments[0].body, 'from cache after Active column replace');
  fs.rmSync(storage, { recursive: true, force: true });
});

test('document thread persists without source text (全文评论)', () => {
  const created = createDocumentThread('whole-doc note');
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(created.thread.anchor.kind, 'document');
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-doc-'));
  const key = '/Users/z/Notes/doc.md';
  assert.equal(persistThread(storage, key, created.thread).ok, true);
  assert.equal(loadDoc(storage, key).threads.length, 1);
  fs.rmSync(storage, { recursive: true, force: true });
});

test('persistThread reports a clear error when storage is not writable', () => {
  const created = createDocumentThread('will fail');
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-ro-'));
  fs.writeFileSync(path.join(blocked, 'docs'), 'not-a-directory', 'utf8');
  const result = persistThread(blocked, '/tmp/a.md', created.thread);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.startsWith(STORAGE_WRITE_FAILED_MESSAGE));
  }
  fs.rmSync(blocked, { recursive: true, force: true });
});
