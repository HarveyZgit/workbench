import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlainTextDocument, Position, Range } from '../src/text-model.ts';
import { buildAnchorFromRange, relocate, mapRenderedSelectionToRange } from '../src/anchor.ts';

test('PlainTextDocument offset/position/lineAt round-trip', () => {
  const doc = PlainTextDocument.fromString('hello\nworld\n');
  assert.equal(doc.lineCount, 3);
  assert.equal(doc.lineAt(0).text, 'hello');
  assert.equal(doc.lineAt(1).text, 'world');
  assert.equal(doc.lineAt(2).text, '');
  assert.equal(doc.getText(new Range(0, 1, 1, 2)), 'ello\nwo');
  assert.deepEqual(doc.positionAt(0), new Position(0, 0));
  assert.deepEqual(doc.positionAt(6), new Position(1, 0));
  assert.equal(doc.offsetAt(new Position(1, 2)), 8);
});

test('buildAnchorFromRange and relocate', () => {
  const text = 'aaa hello bbb\nccc hello ddd\n';
  const doc = PlainTextDocument.fromString(text);
  const range = new Range(0, 4, 0, 9);
  const anchor = buildAnchorFromRange(doc, range, 'selection');
  assert.equal(anchor.quote, 'hello');
  const moved = PlainTextDocument.fromString('zzz\naaa hello bbb\nccc hello ddd\n');
  const located = relocate(moved, anchor);
  assert.ok(located);
  assert.equal(moved.getText(located!), 'hello');
  assert.equal(located!.start.line, 1);
});

test('mapRenderedSelectionToRange falls back to block', () => {
  const doc = PlainTextDocument.fromString('**hello** world\n');
  const range = mapRenderedSelectionToRange(doc, {
    blockStartLine: 0,
    blockEndLine: 1,
    quote: 'hello',
    before: '',
    after: '',
    spansMultipleBlocks: false,
  });
  assert.ok(range);
  assert.equal(doc.getText(range!), 'hello');
});
