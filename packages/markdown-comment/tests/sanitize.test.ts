import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeInlineHtmlToken } from '../src/preview/sanitize.ts';

test('sanitizeInlineHtmlToken keeps allowed closing tags and strips others', () => {
  assert.equal(sanitizeInlineHtmlToken('</strong>'), '</strong>');
  assert.equal(sanitizeInlineHtmlToken('</script>'), '');
  assert.equal(sanitizeInlineHtmlToken('<script>'), '');
  assert.equal(sanitizeInlineHtmlToken('not-a-tag'), '');
});
