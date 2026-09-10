import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlainTextDocument, Range } from '../src/text-model.ts';

test('PlainTextDocument maps offsets across lf and crlf', () => {
  const lf = PlainTextDocument.fromString('ab\ncd');
  assert.equal(lf.lineCount, 2);
  assert.equal(lf.lineAt(0).text, 'ab');
  assert.equal(lf.offsetAt({ line: 1, character: 1 }), 4);
  assert.equal(lf.positionAt(4).line, 1);
  assert.equal(lf.getText(new Range(0, 1, 1, 1)), 'b\nc');

  const crlf = PlainTextDocument.fromString('ab\r\ncd');
  assert.equal(crlf.lineCount, 2);
  assert.equal(crlf.lineAt(0).text, 'ab');
  assert.equal(crlf.offsetAt({ line: 1, character: 0 }), 4);
  assert.equal(crlf.getText(), 'ab\r\ncd');
});

test('empty document still has one line', () => {
  const doc = PlainTextDocument.fromString('');
  assert.equal(doc.lineCount, 1);
  assert.equal(doc.lineAt(0).text, '');
  assert.equal(doc.offsetAt({ line: 0, character: 0 }), 0);
});
