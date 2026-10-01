// 锚点核心（编辑器无关）：纯文本 + offset 的构建 / 重定位 / 渲染选区翻译。
// 不得 import vscode、obsidian 或任何 DOM 全局；各适配器自行把自己的坐标换成 offset。
import type { StoredAnchor } from '../types';
import type { RenderedSelection } from '../preview/messages';

export const CONTEXT_LEN = 40;

const CR = 13;
const LF = 10;

/** 半开区间 [start, end)，单位是 text 的 UTF-16 字符下标。 */
export interface TextRange {
  start: number;
  end: number;
}

export interface TextPosition {
  line: number;
  character: number;
}

// ─── 行列 ↔ offset ────────────────────────────────────────────────

/** 每一行起点的 offset；行分隔符为 \r\n、\n 或单独的 \r（与 VS Code 一致）。总是至少有一行。 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === CR) {
      if (text.charCodeAt(i + 1) === LF) {
        i++;
      }
      starts.push(i + 1);
    } else if (ch === LF) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 某行内容的终点 offset（不含行分隔符）。 */
function lineEndOffset(text: string, starts: number[], line: number): number {
  if (line + 1 >= starts.length) {
    return text.length;
  }
  let end = starts[line + 1] - 1;
  if (text.charCodeAt(end) === LF && end > 0 && text.charCodeAt(end - 1) === CR) {
    end--;
  }
  return end;
}

/** 行列 → offset；越界的行 / 列夹到有效范围内（与 VS Code `validatePosition` 一致）。 */
export function offsetAt(text: string, starts: number[], line: number, character: number): number {
  if (line < 0) {
    return 0;
  }
  if (line >= starts.length) {
    return text.length;
  }
  const lineStart = starts[line];
  const lineLen = lineEndOffset(text, starts, line) - lineStart;
  return lineStart + Math.min(Math.max(0, character), lineLen);
}

/** offset → 行列；越界的 offset 夹到 [0, text.length]。 */
export function positionAt(text: string, starts: number[], offset: number): TextPosition {
  const clamped = Math.min(Math.max(0, offset), text.length);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= clamped) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: clamped - starts[lo] };
}

// ─── 锚点 ─────────────────────────────────────────────────────────

/** 从一段 offset 范围构建锚点（document 类型锚到文件顶部）。 */
export function buildAnchor(text: string, range: TextRange, kind: 'selection' | 'document'): StoredAnchor {
  if (kind === 'document') {
    return {
      kind: 'document',
      startLine: 0,
      startChar: 0,
      endLine: 0,
      endChar: 0,
      quote: '',
      before: '',
      after: '',
    };
  }
  const starts = lineStarts(text);
  const start = positionAt(text, starts, range.start);
  const end = positionAt(text, starts, range.end);
  return {
    kind: 'selection',
    startLine: start.line,
    startChar: start.character,
    endLine: end.line,
    endChar: end.character,
    quote: text.slice(range.start, range.end),
    before: text.slice(Math.max(0, range.start - CONTEXT_LEN), range.start),
    after: text.slice(range.end, range.end + CONTEXT_LEN),
  };
}

/** 把存储锚点重新映射到当前文本；返回 null 表示原文已删除、锚点失效。 */
export function relocate(text: string, a: StoredAnchor): TextRange | null {
  if (a.kind === 'document') {
    return { start: 0, end: 0 };
  }
  const starts = lineStarts(text);
  const lastLine = Math.max(0, starts.length - 1);
  if (a.startLine <= lastLine && a.endLine <= lastLine) {
    let origStart = offsetAt(text, starts, a.startLine, a.startChar);
    let origEnd = offsetAt(text, starts, a.endLine, a.endChar);
    if (origStart > origEnd) {
      [origStart, origEnd] = [origEnd, origStart];
    }
    if (a.quote.length > 0 && text.slice(origStart, origEnd) === a.quote) {
      const before = text.slice(Math.max(0, origStart - a.before.length), origStart);
      const after = text.slice(origStart + a.quote.length, origStart + a.quote.length + a.after.length);
      const beforeMatches = !a.before || before.endsWith(a.before);
      const afterMatches = !a.after || after.startsWith(a.after);
      if (beforeMatches && afterMatches) {
        return { start: origStart, end: origEnd };
      }
    }
  }
  if (a.quote.length === 0) {
    const at = starts[Math.min(a.startLine, lastLine)];
    return { start: at, end: at };
  }
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(a.quote); i >= 0; i = text.indexOf(a.quote, i + 1)) {
    const dist = Math.abs(positionAt(text, starts, i).line - a.startLine);
    const before = text.slice(Math.max(0, i - a.before.length), i);
    const after = text.slice(i + a.quote.length, i + a.quote.length + a.after.length);
    let score = -dist;
    const beforeMatches = !!a.before && before.endsWith(a.before);
    const afterMatches = !!a.after && after.startsWith(a.after);
    if (beforeMatches && afterMatches) {
      score += 1_000_000;
    } else if (afterMatches) {
      score += 10_000;
    } else if (beforeMatches) {
      score += 1_000;
    }
    if ((beforeMatches || afterMatches) && score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) {
    return null;
  }
  return { start: best, end: best + a.quote.length };
}

/** 在 hay 里找 needle，多处命中时用前后文消歧；返回字符下标或 -1。 */
export function locate(hay: string, needle: string, before: string, after: string): number {
  if (!needle) {
    return -1;
  }
  const occ: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    occ.push(i);
  }
  if (occ.length <= 1) {
    return occ.length === 1 ? occ[0] : -1;
  }
  let best = occ[0];
  let bestScore = -1;
  for (const i of occ) {
    const pre = hay.slice(Math.max(0, i - before.length), i);
    const post = hay.slice(i + needle.length, i + needle.length + after.length);
    let score = 0;
    if (before && pre.endsWith(before)) {
      score += 2;
    }
    if (after && post.startsWith(after)) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** 去掉范围首尾纯空白后的实体范围（整块退回时用，避免锚到行尾换行）。 */
function trimmedRange(text: string, range: TextRange): TextRange {
  const slice = text.slice(range.start, range.end);
  const lead = slice.length - slice.trimStart().length;
  const trail = slice.length - slice.trimEnd().length;
  if (lead + trail >= slice.length) {
    return range; // 全是空白，原样返回
  }
  return { start: range.start + lead, end: range.end - trail };
}

/** 把渲染块的源码行范围转换成实体范围。endLineExclusive 为排他行号。 */
export function blockLinesToRange(
  text: string,
  startLine: number,
  endLineExclusive: number,
): TextRange | null {
  const starts = lineStarts(text);
  const lineCount = starts.length;
  if (lineCount === 0) {
    return null;
  }
  const lastLine = lineCount - 1;
  const safeStartLine = Math.min(Math.max(0, startLine), lastLine);
  const safeEndLineExclusive = Math.min(Math.max(endLineExclusive, safeStartLine + 1), lineCount);
  const start = starts[safeStartLine];
  const end = safeEndLineExclusive >= lineCount ? text.length : starts[safeEndLineExclusive];
  return trimmedRange(text, { start, end });
}

/**
 * 把渲染选区翻译成源码范围。
 * 单块内且块源码能原样搜到 quote → 精确锚（选词级）；
 * 跨块 / 子串夹了 **、链接符号搜不到 → 退回整块范围。
 */
export function mapRenderedSelectionToRange(text: string, sel: RenderedSelection): TextRange | null {
  const blockRange = blockLinesToRange(text, sel.blockStartLine, sel.blockEndLine);
  if (!blockRange) {
    return null;
  }

  if (!sel.spansMultipleBlocks && sel.quote) {
    const blockText = text.slice(blockRange.start, blockRange.end);
    const idx = locate(blockText, sel.quote, sel.before, sel.after);
    if (idx >= 0) {
      const startOffset = blockRange.start + idx;
      return { start: startOffset, end: startOffset + sel.quote.length };
    }
  }
  return blockRange;
}
