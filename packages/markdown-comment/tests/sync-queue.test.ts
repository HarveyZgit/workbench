import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyncQueue } from '../src/preview/sync-queue.ts';

test('sync queue take drains pending items', () => {
  const q = createSyncQueue<string>();
  q.enqueue('a');
  q.enqueue('b');
  assert.equal(q.size(), 2);
  assert.deepEqual(q.pending(), ['a', 'b']);
  assert.deepEqual(q.take(), ['a', 'b']);
  assert.equal(q.size(), 0);
  assert.deepEqual(q.take(), []);
});
