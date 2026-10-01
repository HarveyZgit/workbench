import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relocate } from '../src/core/anchor.ts';
import {
  anchorFromRenderedSelection,
  clip,
  formatBody,
  frontmatterLineCount,
  isOrphaned,
  paragraphLines,
  parseLabel,
  pickSourceText,
  quoteLabel,
  resolveSectionLines,
} from '../src/adapters/obsidian/model.ts';
import type { StoredAnchor } from '../src/types.ts';

const NOTE = [
  '---',
  'title: 用例模型',
  'tags: [a]',
  '---',
  '',
  '# 概述',
  '',
  '正文第一段，含 **粗体** 与 [[链接]]。',
  '',
  '![[图.png]]',
  '',
].join('\n');

test('label prefix round-trips through the first comment body', () => {
  assert.equal(formatBody('不清楚', '  这里没讲清楚 '), '[不清楚] 这里没讲清楚');
  assert.equal(formatBody(null, ' 无标签 '), '无标签');
  assert.deepEqual(parseLabel('[有误] 数字不对'), { label: '有误', text: '数字不对' });
  // 只认已知标签，避免吃掉正文里 [1] 之类的方括号。
  assert.deepEqual(parseLabel('[1] 脚注'), { label: null, text: '[1] 脚注' });
  assert.deepEqual(parseLabel('没有前缀'), { label: null, text: '没有前缀' });
});

test('clip flattens whitespace and truncates', () => {
  assert.equal(clip('a\n  b'), 'a b');
  assert.equal(clip('x'.repeat(50)), `${'x'.repeat(40)}…`);
});

function anchor(extra: Partial<StoredAnchor>): StoredAnchor {
  return {
    kind: 'selection',
    startLine: 0,
    startChar: 0,
    endLine: 0,
    endChar: 0,
    quote: 'q',
    before: '',
    after: '',
    ...extra,
  };
}

test('isOrphaned mirrors the CLI rule (quote no longer in text)', () => {
  assert.equal(isOrphaned('has q here', anchor({})), false);
  assert.equal(isOrphaned('gone', anchor({})), true);
  assert.equal(isOrphaned('gone', anchor({ kind: 'document', quote: '' })), false);
  assert.equal(isOrphaned('gone', anchor({ quote: '' })), false);
  assert.equal(isOrphaned('gone', anchor({ target: { kind: 'mermaid-diagram' } })), false);
});

test('quoteLabel prefers rendered quote, falls back to source quote, document is fixed copy', () => {
  assert.equal(
    quoteLabel(anchor({ quote: 'src', rendered: { quote: '渲染', before: '', after: '' } })),
    '渲染',
  );
  assert.equal(quoteLabel(anchor({ quote: 'src' })), 'src');
  assert.equal(quoteLabel(anchor({ quote: '> [!tip] 取舍' })), '[!tip] 取舍');
  assert.equal(quoteLabel(anchor({ kind: 'document', quote: '' })), '📄 全文');
});

test('anchorFromRenderedSelection: bold/link markup falls back to block, rendered quote kept', () => {
  const sel = {
    blockStartLine: 7,
    blockEndLine: 8,
    quote: '粗体 与 链接',
    before: '正文第一段，含 ',
    after: '。',
    spansMultipleBlocks: false,
  };
  const a = anchorFromRenderedSelection(NOTE, sel);
  assert.ok(a);
  assert.equal(a.quote, '正文第一段，含 **粗体** 与 [[链接]]。');
  assert.equal(a.startLine, 7);
  assert.deepEqual(a.rendered, { quote: '粗体 与 链接', before: '正文第一段，含 ', after: '。' });
});

test('anchorFromRenderedSelection: whole-block (image) stores block source and no rendered quote', () => {
  const a = anchorFromRenderedSelection(NOTE, {
    blockStartLine: 9,
    blockEndLine: 10,
    quote: '',
    before: '',
    after: '',
    spansMultipleBlocks: true,
  });
  assert.ok(a);
  assert.equal(a.quote, '![[图.png]]');
  assert.equal(a.rendered, undefined);
  const r = relocate(`新增\n${NOTE}`, a);
  assert.ok(r);
  assert.equal(`新增\n${NOTE}`.slice(r.start, r.end), '![[图.png]]');
});

test('frontmatterLineCount', () => {
  assert.equal(frontmatterLineCount(NOTE), 4);
  assert.equal(frontmatterLineCount('# 无 front matter\n'), 0);
  assert.equal(frontmatterLineCount('---\n未闭合\n'), 0);
  assert.equal(frontmatterLineCount(NOTE.replaceAll('\n', '\r\n')), 4);
});

test('resolveSectionLines: info.text is the whole file → line numbers are file lines (frontmatter included)', () => {
  assert.deepEqual(resolveSectionLines(NOTE, { text: NOTE, lineStart: 7, lineEnd: 7 }), {
    startLine: 7,
    endLine: 7,
  });
  // CRLF 与 LF 不影响比对。
  const crlf = NOTE.replaceAll('\n', '\r\n');
  assert.deepEqual(resolveSectionLines(crlf, { text: NOTE, lineStart: 9, lineEnd: 9 }), {
    startLine: 9,
    endLine: 9,
  });
});

test('resolveSectionLines: info.text is a snippet → verified against the file, frontmatter offset applied only if content matches', () => {
  const snippet = '正文第一段，含 **粗体** 与 [[链接]]。';
  // 行号已是文件行号。
  assert.deepEqual(resolveSectionLines(NOTE, { text: snippet, lineStart: 7, lineEnd: 7 }), {
    startLine: 7,
    endLine: 7,
  });
  // 行号相对正文（不含 front matter 的 4 行）→ 补上偏移。
  assert.deepEqual(resolveSectionLines(NOTE, { text: snippet, lineStart: 3, lineEnd: 3 }), {
    startLine: 7,
    endLine: 7,
  });
});

test('resolveSectionLines: unverifiable or stale info → null (never guess)', () => {
  assert.equal(resolveSectionLines(NOTE, { text: '完全不同的内容', lineStart: 7, lineEnd: 7 }), null);
  assert.equal(resolveSectionLines(NOTE, { text: NOTE, lineStart: 50, lineEnd: 50 }), null);
  assert.equal(resolveSectionLines(NOTE, { text: NOTE, lineStart: -1, lineEnd: 2 }), null);
  assert.equal(resolveSectionLines(NOTE, { text: NOTE, lineStart: 5, lineEnd: 2 }), null);
  // 文件刚被改（info 仍是旧全文）→ 不乱锚。
  assert.equal(resolveSectionLines(`${NOTE}多一行\n`, { text: NOTE, lineStart: 7, lineEnd: 7 }), null);
});

test('pickSourceText keeps disk text (with CRLF) when the editor buffer is just a normalized copy', () => {
  const disk = 'a\r\nb\r\n';
  assert.equal(pickSourceText('a\nb\n', disk), disk);
  assert.equal(pickSourceText('a\nB\n', disk), 'a\nB\n');
});

test('paragraphLines finds the blank-line delimited paragraph around a line', () => {
  const text = 'p1a\np1b\n\np2\n\np3a\np3b';
  assert.deepEqual(paragraphLines(text, 1), { startLine: 0, endLine: 1 });
  assert.deepEqual(paragraphLines(text, 3), { startLine: 3, endLine: 3 });
  assert.deepEqual(paragraphLines(text, 99), { startLine: 5, endLine: 6 });
});
