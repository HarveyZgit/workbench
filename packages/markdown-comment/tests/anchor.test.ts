import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockLinesToRange,
  buildAnchor,
  lineStarts,
  mapRenderedSelectionToRange,
  offsetAt,
  positionAt,
  relocate,
} from '../src/core/anchor.ts';
import type { RenderedSelection } from '../src/preview/messages.ts';

const DOC = ['# 标题', '', '第一段：用户登录后进入首页。', '', '第二段：系统会发送验证邮件。', ''].join('\n');

function select(text: string, quote: string, occurrence = 0) {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = text.indexOf(quote, idx + 1);
  }
  assert.ok(idx >= 0, `quote not found: ${quote}`);
  return { start: idx, end: idx + quote.length };
}

function slice(text: string, r: { start: number; end: number } | null): string | null {
  return r && text.slice(r.start, r.end);
}

test('lineStarts / offsetAt / positionAt handle \\n, \\r\\n and lone \\r', () => {
  assert.deepEqual(lineStarts(''), [0]);
  assert.deepEqual(lineStarts('a\nb\r\nc\rd'), [0, 2, 5, 7]);

  const text = 'ab\r\ncd\nef';
  const starts = lineStarts(text);
  assert.deepEqual(positionAt(text, starts, 0), { line: 0, character: 0 });
  assert.deepEqual(positionAt(text, starts, 4), { line: 1, character: 0 });
  assert.deepEqual(positionAt(text, starts, text.length), { line: 2, character: 2 });
  assert.deepEqual(positionAt(text, starts, 999), { line: 2, character: 2 });
  assert.equal(offsetAt(text, starts, 1, 1), 5);
  // 列越界夹到行尾（不含行分隔符），行越界夹到文末。
  assert.equal(offsetAt(text, starts, 0, 99), 2);
  assert.equal(offsetAt(text, starts, 99, 0), text.length);
  assert.equal(offsetAt(text, starts, -1, 3), 0);
});

test('buildAnchor records line/char, quote and context', () => {
  const range = select(DOC, '验证邮件');
  const a = buildAnchor(DOC, range, 'selection');
  assert.equal(a.kind, 'selection');
  assert.equal(a.quote, '验证邮件');
  assert.equal(a.startLine, 4);
  assert.equal(a.endLine, 4);
  assert.equal(a.startChar, '第二段：系统会发送'.length);
  assert.equal(a.endChar, a.startChar + '验证邮件'.length);
  assert.equal(a.before, DOC.slice(Math.max(0, range.start - 40), range.start));
  assert.equal(a.after, '。\n');
});

test('buildAnchor context is clipped to 40 chars on both sides', () => {
  const text = `${'a'.repeat(100)}TARGET${'b'.repeat(100)}`;
  const a = buildAnchor(text, select(text, 'TARGET'), 'selection');
  assert.equal(a.before, 'a'.repeat(40));
  assert.equal(a.after, 'b'.repeat(40));
});

test('buildAnchor document kind anchors to the top with empty quote', () => {
  const a = buildAnchor(DOC, { start: 10, end: 20 }, 'document');
  assert.deepEqual(a, {
    kind: 'document',
    startLine: 0,
    startChar: 0,
    endLine: 0,
    endChar: 0,
    quote: '',
    before: '',
    after: '',
  });
  assert.deepEqual(relocate('anything', a), { start: 0, end: 0 });
});

test('relocate: unchanged text resolves to the exact original range', () => {
  const range = select(DOC, '验证邮件');
  const a = buildAnchor(DOC, range, 'selection');
  assert.deepEqual(relocate(DOC, a), range);
});

test('relocate: inserting a line above follows the quote', () => {
  const a = buildAnchor(DOC, select(DOC, '验证邮件'), 'selection');
  const edited = `新增一行\n${DOC}`;
  const r = relocate(edited, a);
  assert.equal(slice(edited, r), '验证邮件');
  assert.equal(positionAt(edited, lineStarts(edited), r!.start).line, a.startLine + 1);
});

test('relocate: text edited in place on the same line still follows via context', () => {
  const a = buildAnchor(DOC, select(DOC, '验证邮件'), 'selection');
  const edited = DOC.replace('第二段：系统会发送', '第二段：系统在注册成功后会立刻发送');
  const r = relocate(edited, a);
  assert.equal(slice(edited, r), '验证邮件');
});

test('relocate: quote half rewritten → null (orphaned)', () => {
  const a = buildAnchor(DOC, select(DOC, '系统会发送验证邮件'), 'selection');
  const edited = DOC.replace('系统会发送验证邮件', '系统会发送短信');
  assert.equal(relocate(edited, a), null);
});

test('relocate: quote removed entirely → null', () => {
  const a = buildAnchor(DOC, select(DOC, '验证邮件'), 'selection');
  assert.equal(relocate('# 标题\n\n只剩这一句。\n', a), null);
});

test('relocate: repeated phrase is disambiguated by surrounding context', () => {
  const text = ['前面说明 A：请点击确认按钮。', '', '后面说明 B：请点击确认按钮。', ''].join('\n');
  const second = select(text, '请点击确认按钮', 1);
  const a = buildAnchor(text, second, 'selection');

  // 在文首插入两行，原行号信息失效，只能靠前后文区分两处相同引用。
  const edited = `插入一行\n再插入一行\n${text}`;
  const r = relocate(edited, a);
  assert.ok(r);
  assert.equal(slice(edited, r), '请点击确认按钮');
  assert.ok(edited.slice(r.start - 5, r.start).includes('B：'), 'should pick the occurrence after "B："');

  // 同样的做法选第一处，不会错落到第二处。
  const first = buildAnchor(text, select(text, '请点击确认按钮', 0), 'selection');
  const r1 = relocate(edited, first);
  assert.ok(r1);
  assert.ok(edited.slice(r1.start - 5, r1.start).includes('A：'));
});

test('relocate: repeated phrase without any context match is not guessed', () => {
  const text = '甲：重复短语。\n\n乙：重复短语。\n';
  const a = buildAnchor(text, select(text, '重复短语', 1), 'selection');
  const rewritten = '子：重复短语\n\n丑：重复短语\n';
  // 前后文都对不上 → 不乱猜，视为失联。
  assert.equal(relocate(rewritten, a), null);
});

test('relocate: empty quote falls back to the start line', () => {
  const a = buildAnchor(DOC, { start: 0, end: 0 }, 'selection');
  const r = relocate(DOC, { ...a, startLine: 99 });
  assert.deepEqual(r, { start: lineStarts(DOC).at(-1), end: lineStarts(DOC).at(-1) });
});

test('relocate works on CRLF text', () => {
  const crlf = DOC.replaceAll('\n', '\r\n');
  const a = buildAnchor(crlf, select(crlf, '验证邮件'), 'selection');
  assert.equal(a.startLine, 4);
  const edited = `头部\r\n${crlf}`;
  assert.equal(slice(edited, relocate(edited, a)), '验证邮件');
});

test('blockLinesToRange: trims surrounding whitespace and clamps bounds', () => {
  // 行 2 是 "第一段…"，排他终点 3 会带上行尾换行，应被裁掉。
  const r = blockLinesToRange(DOC, 2, 3);
  assert.equal(slice(DOC, r), '第一段：用户登录后进入首页。');
  // 越界：起点 / 终点都夹到文末，不返回 null。
  const tail = blockLinesToRange(DOC, 99, 120);
  assert.ok(tail);
  assert.ok(tail.end <= DOC.length);
  // 终点不大于起点时至少取一行。
  assert.equal(slice(DOC, blockLinesToRange(DOC, 4, 0)), '第二段：系统会发送验证邮件。');
});

test('blockLinesToRange: whitespace-only block is returned as is', () => {
  const text = 'a\n   \nb';
  const r = blockLinesToRange(text, 1, 2);
  assert.equal(slice(text, r), '   \n');
});

function sel(partial: Partial<RenderedSelection>): RenderedSelection {
  return {
    blockStartLine: 2,
    blockEndLine: 3,
    quote: '',
    before: '',
    after: '',
    spansMultipleBlocks: false,
    ...partial,
  };
}

test('mapRenderedSelectionToRange: single-block selection is anchored precisely', () => {
  const r = mapRenderedSelectionToRange(DOC, sel({ quote: '进入首页', before: '用户登录后', after: '。' }));
  assert.equal(slice(DOC, r), '进入首页');
});

test('mapRenderedSelectionToRange: duplicate quote inside block uses rendered context', () => {
  const text = '重复 X 在前，重复 Y 在后。\n';
  const r = mapRenderedSelectionToRange(
    text,
    sel({ blockStartLine: 0, blockEndLine: 1, quote: '重复', before: '在前，', after: ' Y' }),
  );
  assert.ok(r);
  assert.equal(text.slice(r.start, r.end + 2), '重复 Y');
});

test('mapRenderedSelectionToRange: selection spanning blocks falls back to whole block range', () => {
  const r = mapRenderedSelectionToRange(
    DOC,
    sel({ blockStartLine: 2, blockEndLine: 5, quote: '首页。 第二段', spansMultipleBlocks: true }),
  );
  assert.equal(slice(DOC, r), '第一段：用户登录后进入首页。\n\n第二段：系统会发送验证邮件。');
});

test('mapRenderedSelectionToRange: rendered text not found in source (bold/link markup) falls back to block', () => {
  const text = '这里有 **加粗词** 和 [[链接|别名]] 文字。\n';
  const r = mapRenderedSelectionToRange(
    text,
    sel({ blockStartLine: 0, blockEndLine: 1, quote: '加粗词 和 别名' }),
  );
  assert.equal(slice(text, r), '这里有 **加粗词** 和 [[链接|别名]] 文字。');
});

test('mapRenderedSelectionToRange: whole-block request (empty quote) returns the block source', () => {
  const text = '前文\n\n![[图.png]]\n\n后文\n';
  const r = mapRenderedSelectionToRange(
    text,
    sel({ blockStartLine: 2, blockEndLine: 3, quote: '', spansMultipleBlocks: true }),
  );
  assert.equal(slice(text, r), '![[图.png]]');
});

test('mapRenderedSelectionToRange + buildAnchor + relocate round-trip after a line is inserted above', () => {
  const range = mapRenderedSelectionToRange(
    DOC,
    sel({ quote: '进入首页', before: '用户登录后', after: '。' }),
  );
  assert.ok(range);
  const anchor = buildAnchor(DOC, range, 'selection');
  const edited = `---\ntitle: x\n---\n${DOC}`;
  assert.equal(slice(edited, relocate(edited, anchor)), '进入首页');
});
