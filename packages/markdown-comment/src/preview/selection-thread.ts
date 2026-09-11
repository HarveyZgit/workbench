// Host-neutral 划词 thread factory: maps a rendered selection onto source text
// without vscode.TextDocument or a workspace folder.
import { randomUUID } from 'node:crypto';
import { buildAnchorFromRange, mapRenderedSelectionToRange } from '../anchor';
import { SOURCE_UNREADABLE_MESSAGE } from '../document-uri';
import { PlainTextDocument } from '../text-model';
import type { StoredThread } from '../types';
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
