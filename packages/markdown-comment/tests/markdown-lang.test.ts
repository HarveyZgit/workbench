import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKDOWN_EXTENSIONS,
  MARKDOWN_EXTNAME_PATTERN,
  hasMarkdownExtension,
  isMarkdownDocument,
} from '../src/markdown-lang.ts';

test('markdown extensions cover common suffixes', () => {
  assert.ok(MARKDOWN_EXTENSIONS.includes('.md'));
  assert.ok(hasMarkdownExtension('README.MD'));
  assert.ok(hasMarkdownExtension('/tmp/note.markdown'));
  assert.equal(hasMarkdownExtension('note.txt'), false);
  assert.match('.md', new RegExp(MARKDOWN_EXTNAME_PATTERN, 'i'));
});

test('isMarkdownDocument accepts languageId or suffix fallback', () => {
  assert.equal(isMarkdownDocument('markdown', 'SKILL.txt'), true);
  assert.equal(isMarkdownDocument('plaintext', 'AGENTS.md'), true);
  assert.equal(isMarkdownDocument('typescript', 'foo.ts'), false);
});
