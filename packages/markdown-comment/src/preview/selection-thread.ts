// Host-neutral 划词 / 全文 thread factory: maps a rendered selection onto source text
// without vscode.TextDocument or a workspace folder.
import { randomUUID } from 'node:crypto';
import { buildAnchorFromRange, mapRenderedSelectionToRange } from '../anchor';
import { SOURCE_UNREADABLE_MESSAGE, STORAGE_WRITE_FAILED_MESSAGE } from '../document-uri';
import { loadDoc, saveDoc } from '../storage';
import { PlainTextDocument } from '../text-model';
import type { StoredDocument, StoredThread } from '../types';
import type { RenderedSelection } from './messages';

export type SelectionThreadResult = { ok: true; thread: StoredThread } | { ok: false; error: string };

/**
 * Build a selection (划词) thread from source text + a rendered preview selection.
 * Works for a saved file with no workspace folder: pass the file contents.
 */
export function createSelectionThreadFromText(
  sourceText: string,
  selection: RenderedSelection,
  body: string,
): SelectionThreadResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: 'empty' };
  }
  if (!sourceText) {
    return { ok: false, error: SOURCE_UNREADABLE_MESSAGE };
  }
  const model = PlainTextDocument.fromString(sourceText);
  const range = mapRenderedSelectionToRange(model, selection);
  if (!range) {
    return { ok: false, error: '无法把这段选区定位回源码' };
  }
  const anchor = buildAnchorFromRange(model, range, 'selection');
  anchor.rendered = { quote: selection.quote, before: selection.before, after: selection.after };
  return {
    ok: true,
    thread: {
      id: randomUUID(),
      anchor,
      status: 'open',
      comments: [{ id: randomUUID(), author: 'user', body: trimmed, createdAt: new Date().toISOString() }],
    },
  };
}

/** 全文评论：不依赖源码可读。 */
export function createDocumentThread(body: string): SelectionThreadResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: 'empty' };
  }
  return {
    ok: true,
    thread: {
      id: randomUUID(),
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
      status: 'open',
      comments: [{ id: randomUUID(), author: 'user', body: trimmed, createdAt: new Date().toISOString() }],
    },
  };
}

export function persistThread(
  storageDir: string,
  docKey: string,
  thread: StoredThread,
): { ok: true } | { ok: false; error: string } {
  try {
    const stored: StoredDocument = loadDoc(storageDir, docKey);
    stored.threads.push(thread);
    saveDoc(storageDir, docKey, stored);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${STORAGE_WRITE_FAILED_MESSAGE}（${detail}）` };
  }
}
