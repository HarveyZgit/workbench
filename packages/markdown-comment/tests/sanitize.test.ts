import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeInlineHtmlToken } from '../src/preview/sanitize.ts';

test('sanitizeInlineHtmlToken keeps allowed closing tags and strips others', () => {
  assert.equal(sanitizeInlineHtmlToken('</strong>'), '</strong>');
  assert.equal(sanitizeInlineHtmlToken('</script>'), '');
  assert.equal(sanitizeInlineHtmlToken('<script>'), '');
  assert.equal(sanitizeInlineHtmlToken('not-a-tag'), '');
});

test('sanitize keeps read-only task list checkboxes only', () => {
  const unchecked = '<input class="task-list-item-checkbox" type="checkbox" disabled="">';
  const checked = '<input class="task-list-item-checkbox" checked="" type="checkbox" disabled="">';
  assert.match(sanitizeInlineHtmlToken(unchecked), /task-list-item-checkbox/);
  assert.match(sanitizeInlineHtmlToken(checked), /checked=""/);
  assert.equal(sanitizeInlineHtmlToken('<input type="checkbox">'), '');
  assert.equal(sanitizeInlineHtmlToken('<input class="task-list-item-checkbox" type="text">'), '');
  assert.equal(sanitizeInlineHtmlToken('<input class="task-list-item-checkbox" type="checkbox" onclick="alert(1)">'), '');
});
