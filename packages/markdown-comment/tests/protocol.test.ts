import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CREATE_REJECTED_MESSAGE,
  isCreateIntent,
  isWebviewMessage,
  normalizeLineSpan,
  normalizeRenderedSelection,
} from '../src/preview/protocol.ts';

const validSelection = {
  blockStartLine: 0,
  blockEndLine: 1,
  quote: 'Hello',
  before: '',
  after: ' world',
  spansMultipleBlocks: false,
};

test('isWebviewMessage accepts createThread when blockEndLine equals start (missing data-end-line)', () => {
  const collapsed = {
    type: 'createThread',
    text: 'note',
    selection: { ...validSelection, blockStartLine: 3, blockEndLine: 3 },
  };
  assert.equal(isWebviewMessage(collapsed), true);
  const missingEnd = {
    type: 'createThread',
    text: 'note',
    selection: { ...validSelection, blockStartLine: 5, blockEndLine: 0 },
  };
  assert.equal(isWebviewMessage(missingEnd), true);
});

test('isWebviewMessage accepts createDocThread and rejects empty-looking create without text field', () => {
  assert.equal(isWebviewMessage({ type: 'createDocThread', text: '全文' }), true);
  assert.equal(isWebviewMessage({ type: 'createDocThread' }), false);
  assert.equal(isCreateIntent({ type: 'createDocThread' }), true);
  assert.equal(isCreateIntent({ type: 'ready' }), false);
  assert.ok(CREATE_REJECTED_MESSAGE.includes('评论未能提交'));
});

test('isWebviewMessage accepts mermaid create when endLine is not greater than startLine', () => {
  assert.equal(
    isWebviewMessage({
      type: 'createBlockThread',
      text: '图',
      label: 'flow',
      target: 'mermaid-diagram',
      startLine: 4,
      endLine: 4,
    }),
    true,
  );
  assert.equal(
    isWebviewMessage({
      type: 'createMermaidNodeThread',
      text: '节点',
      label: 'A',
      nodeId: 'A',
      startLine: 2,
      endLine: 0,
    }),
    true,
  );
});

test('normalizeRenderedSelection and normalizeLineSpan expand collapsed ranges', () => {
  const sel = normalizeRenderedSelection({
    blockStartLine: 4,
    blockEndLine: 0,
    quote: 'x',
    before: '',
    after: '',
    spansMultipleBlocks: false,
  });
  assert.equal(sel.blockStartLine, 4);
  assert.equal(sel.blockEndLine, 5);
  assert.deepEqual(normalizeLineSpan(2, 2), { startLine: 2, endLine: 3 });
  assert.deepEqual(normalizeLineSpan(2, 6), { startLine: 2, endLine: 6 });
});

test('normalizeRenderedSelection expands blockEndLine when end is less than start', () => {
  const inverted = normalizeRenderedSelection({
    blockStartLine: 7,
    blockEndLine: 2,
    quote: 'inverted',
    before: '',
    after: '',
    spansMultipleBlocks: false,
  });
  assert.equal(inverted.blockStartLine, 7);
  assert.equal(inverted.blockEndLine, 8);
  assert.deepEqual(normalizeLineSpan(9, 1), { startLine: 9, endLine: 10 });
});
