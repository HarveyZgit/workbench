import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentInputs, moveAttachment, validateDraftFiles } from '../src/preview/attachment-composer.ts';

test('draft image ordering, deletion and retained IDs preserve exact submission order', () => {
  const items = [
    { id: 'existing', name: 'old.png', mime: 'image/png', size: 12 },
    { name: 'new.png', mime: 'image/png', size: 12, data: 'AQID', uri: 'data:image/png;base64,AQID' },
  ];
  moveAttachment(items, 1, -1);
  assert.deepEqual(attachmentInputs(items), [
    { name: 'new.png', mime: 'image/png', data: 'AQID' },
    { id: 'existing' },
  ]);
  moveAttachment(items, 0, -1);
  assert.equal(items[0].name, 'new.png');
  items.splice(0, 1);
  assert.deepEqual(attachmentInputs(items), [{ id: 'existing' }]);
});
test('draft validation rejects unsupported, empty, oversized, excessive and aggregate images', () => {
  validateDraftFiles([], [{ size: 1, type: 'image/png' }]);
  assert.throws(() => validateDraftFiles([], [{ size: 1, type: 'image/svg+xml' }]));
  assert.throws(() => validateDraftFiles([], [{ size: 0, type: 'image/png' }]));
  assert.throws(() => validateDraftFiles([], [{ size: 10 * 1024 * 1024 + 1, type: 'image/png' }]));
  assert.throws(() =>
    validateDraftFiles(
      Array.from({ length: 10 }, () => ({ size: 1 })),
      [{ size: 1, type: 'image/png' }],
    ),
  );
  assert.throws(() => validateDraftFiles([{ size: 30 * 1024 * 1024 }], [{ size: 1, type: 'image/png' }]));
});

test('clipboard images preserve item order and do not duplicate the files fallback', async () => {
  const { clipboardImageFiles } = await import('../src/preview/attachment-composer.ts');
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
  const text = new File(['plain'], 'notes.txt', { type: 'text/plain' });
  const clipboard = {
    items: [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => first },
      { kind: 'file', getAsFile: () => null },
      { kind: 'file', getAsFile: () => text },
      { kind: 'file', getAsFile: () => second },
    ],
    files: [first, second],
  } as unknown as DataTransfer;
  assert.deepEqual(clipboardImageFiles(clipboard), [first, second]);
  assert.deepEqual(
    clipboardImageFiles({ items: [], files: [text, second, first] } as unknown as DataTransfer),
    [second, first],
  );
  assert.deepEqual(clipboardImageFiles({ items: [], files: [text] } as unknown as DataTransfer), []);
});
