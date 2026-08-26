import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePreviewLineChanges } from '../src/preview/diff.ts';

test('detects added modified and deleted line ranges', () => {
  const baseline = 'a\nb\nc\n';
  const current = 'a\nB\nc\nd\n';
  const changes = computePreviewLineChanges(baseline, current);
  assert.ok(changes.modified.length + changes.added.length + changes.deleted.length > 0);
  const addedOnly = computePreviewLineChanges('a\n', 'a\nb\n');
  assert.equal(addedOnly.added[0]?.startLine, 1);
  const deletedOnly = computePreviewLineChanges('a\nb\n', 'a\n');
  assert.equal(deletedOnly.deleted[0]?.count, 1);
});

test('identical documents produce no changes', () => {
  const changes = computePreviewLineChanges('same\n', 'same\n');
  assert.deepEqual(changes, { added: [], modified: [], deleted: [] });
});

test('classifies unequal add and delete hunks around a modification', () => {
  const moreAdded = computePreviewLineChanges('old\nkeep\n', 'new\nextra\nkeep\n');
  assert.ok(moreAdded.modified.length + moreAdded.added.length > 0);
  const moreDeleted = computePreviewLineChanges('a\nb\nc\nkeep\n', 'A\nkeep\n');
  assert.ok(moreDeleted.modified.length + moreDeleted.deleted.length > 0);
  const addedOnlyMid = computePreviewLineChanges('keep\n', 'inserted\nkeep\n');
  assert.equal(addedOnlyMid.added[0]?.startLine, 0);
});
