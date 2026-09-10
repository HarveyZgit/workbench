import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommentMutation } from '../src/preview/comment-ops.ts';
import { isCommentMutation, isWebviewMessage } from '../src/preview/protocol.ts';
import type { StoredDocument } from '../src/types.ts';

function empty(): StoredDocument {
  return { version: 1, threads: [] };
}

test('createDocThread reply resolve and delete persist on the store', () => {
  const stored = empty();
  const created = applyCommentMutation(stored, '# Hi\n', {
    type: 'createDocThread',
    text: 'whole doc',
  });
  assert.equal(created.changed, true);
  assert.equal(stored.threads.length, 1);
  const threadId = stored.threads[0].id;
  assert.equal(stored.threads[0].anchor.kind, 'document');

  assert.equal(
    applyCommentMutation(stored, '# Hi\n', { type: 'reply', threadId, text: 'follow up' }).changed,
    true,
  );
  assert.equal(stored.threads[0].comments.length, 2);

  assert.equal(
    applyCommentMutation(stored, '# Hi\n', { type: 'resolve', threadId, resolved: true }).changed,
    true,
  );
  assert.equal(stored.threads[0].status, 'resolved');

  const commentId = stored.threads[0].comments[0].id;
  assert.equal(
    applyCommentMutation(stored, '# Hi\n', { type: 'deleteComment', threadId, commentId }).changed,
    true,
  );
  assert.equal(stored.threads[0].comments.length, 1);

  assert.equal(applyCommentMutation(stored, '# Hi\n', { type: 'deleteThread', threadId }).changed, true);
  assert.equal(stored.threads.length, 0);
});

test('createThread maps a rendered selection back to source', () => {
  const stored = empty();
  const text = 'Hello world\n\nSecond';
  const result = applyCommentMutation(stored, text, {
    type: 'createThread',
    text: 'note',
    selection: {
      blockStartLine: 0,
      blockEndLine: 1,
      quote: 'Hello',
      before: '',
      after: ' world',
      spansMultipleBlocks: false,
    },
  });
  assert.equal(result.changed, true);
  assert.equal(stored.threads[0].anchor.quote, 'Hello');
  assert.equal(stored.threads[0].anchor.rendered?.quote, 'Hello');
});

test('protocol accepts comment mutations and rejects junk', () => {
  assert.equal(isCommentMutation('createDocThread'), true);
  assert.equal(isCommentMutation('ready'), false);
  assert.equal(isWebviewMessage({ type: 'createDocThread', text: 'x' }), true);
  assert.equal(isWebviewMessage({ type: 'nope' }), false);
});
