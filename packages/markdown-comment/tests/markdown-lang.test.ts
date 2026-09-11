import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKDOWN_EXTENSIONS,
  MARKDOWN_EXTNAME_PATTERN,
  hasMarkdownExtension,
  isCommentableMarkdown,
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

test('isCommentableMarkdown allows untitled markdown and file md', () => {
  assert.equal(isCommentableMarkdown('markdown', { scheme: 'untitled', fsPath: '' }), true);
  assert.equal(isCommentableMarkdown('plaintext', { scheme: 'untitled', fsPath: '' }), false);
  assert.equal(isCommentableMarkdown('markdown', { scheme: 'file', fsPath: '/tmp/a.md' }), true);
  assert.equal(isCommentableMarkdown('plaintext', { scheme: 'file', fsPath: '/tmp/a.md' }), true);
  assert.equal(isCommentableMarkdown('typescript', { scheme: 'file', fsPath: '/tmp/a.ts' }), false);
  assert.equal(isCommentableMarkdown('markdown', { scheme: 'http', fsPath: '' }), false);
});

test('isCommentableMarkdown allows vscode-local and vscode-remote markdown', () => {
  assert.equal(
    isCommentableMarkdown('markdown', { scheme: 'vscode-local', fsPath: '/Users/z/Notes/a.md' }),
    true,
  );
  assert.equal(
    isCommentableMarkdown('plaintext', { scheme: 'vscode-local', fsPath: '/Users/z/Notes/a.md' }),
    true,
  );
  assert.equal(
    isCommentableMarkdown('typescript', { scheme: 'vscode-local', fsPath: '/Users/z/Notes/a.ts' }),
    false,
  );
  assert.equal(isCommentableMarkdown('markdown', { scheme: 'vscode-remote', fsPath: '/home/z/a.md' }), true);
});
