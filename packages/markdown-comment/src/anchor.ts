// 锚点核心：源码 Range ↔ StoredAnchor 的序列化与重定位，源码侧（extension）与
// webview 侧（panel）共用。webview 的渲染选区也在这里翻译回源码范围。
import * as vscode from 'vscode';
import type { StoredAnchor } from './types';
import type { RenderedSelection } from './preview/messages';

export const CONTEXT_LEN = 40;

/** 从一个源码 Range 构建锚点（document 类型锚到文件顶部）。 */
export function buildAnchorFromRange(
  doc: vscode.TextDocument,
  range: vscode.Range,
  kind: 'selection' | 'document',
): StoredAnchor {
  if (kind === 'document') {
    return { kind: 'document', startLine: 0, startChar: 0, endLine: 0, endChar: 0, quote: '', before: '', after: '' };
  }
  const startOffset = doc.offsetAt(range.start);
  const endOffset = doc.offsetAt(range.end);
  return {
    kind: 'selection',
    startLine: range.start.line,
    startChar: range.start.character,
    endLine: range.end.line,
    endChar: range.end.character,
    quote: doc.getText(range),
    before: doc.getText(new vscode.Range(doc.positionAt(Math.max(0, startOffset - CONTEXT_LEN)), range.start)),
    after: doc.getText(new vscode.Range(range.end, doc.positionAt(endOffset + CONTEXT_LEN))),
  };
}

/** 把存储锚点重新映射到当前文档；返回 null 表示原文已删除、锚点失效。 */
export function relocate(doc: vscode.TextDocument, a: StoredAnchor): vscode.Range | null {
  if (a.kind === 'document') {
    return new vscode.Range(0, 0, 0, 0);
  }
  const text = doc.getText();
  const lastLine = Math.max(0, doc.lineCount - 1);
  if (a.startLine <= lastLine && a.endLine <= lastLine) {
    const orig = new vscode.Range(a.startLine, a.startChar, a.endLine, a.endChar);
    if (a.quote.length > 0 && doc.getText(orig) === a.quote) {
      const offset = doc.offsetAt(orig.start);
      const before = text.slice(Math.max(0, offset - a.before.length), offset);
      const after = text.slice(offset + a.quote.length, offset + a.quote.length + a.after.length);
      const beforeMatches = !a.before || before.endsWith(a.before);
      const afterMatches = !a.after || after.startsWith(a.after);
      if (beforeMatches && afterMatches) {
        return orig;
      }
    }
  }
  if (a.quote.length === 0) {
    return new vscode.Range(Math.min(a.startLine, lastLine), 0, Math.min(a.startLine, lastLine), 0);
  }
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(a.quote); i >= 0; i = text.indexOf(a.quote, i + 1)) {
    const dist = Math.abs(doc.positionAt(i).line - a.startLine);
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
  return new vscode.Range(doc.positionAt(best), doc.positionAt(best + a.quote.length));
}

/** 在 hay 里找 needle，多处命中时用渲染态前后文消歧；返回字符下标或 -1。 */
function locate(hay: string, needle: string, before: string, after: string): number {
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

/** 去掉 Range 首尾纯空白后的实体范围（整块退回时用，避免锚到行尾换行）。 */
function trimmedRange(doc: vscode.TextDocument, range: vscode.Range): vscode.Range {
  const text = doc.getText(range);
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  if (lead + trail >= text.length) {
    return range; // 全是空白，原样返回
  }
  const startOffset = doc.offsetAt(range.start) + lead;
  const endOffset = doc.offsetAt(range.end) - trail;
  return new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
}

/** 把渲染块的源码行范围转换成实体 Range。endLineExclusive 为排他行号。 */
export function blockLinesToRange(doc: vscode.TextDocument, startLine: number, endLineExclusive: number): vscode.Range | null {
  if (doc.lineCount === 0) {
    return null;
  }
  const lastLine = doc.lineCount - 1;
  const safeStartLine = Math.min(Math.max(0, startLine), lastLine);
  const safeEndLineExclusive = Math.min(Math.max(endLineExclusive, safeStartLine + 1), doc.lineCount);
  const start = new vscode.Position(safeStartLine, 0);
  const end =
    safeEndLineExclusive >= doc.lineCount ? doc.lineAt(lastLine).range.end : new vscode.Position(safeEndLineExclusive, 0);
  return trimmedRange(doc, new vscode.Range(start, end));
}

/**
 * 把 webview 上报的渲染选区翻译成源码 Range。
 * 单块内且块源码能原样搜到 renderedQuote → 精确锚（选词级）；
 * 跨块 / 子串夹了 **、链接符号搜不到 → 退回整块范围。
 */
export function mapRenderedSelectionToRange(doc: vscode.TextDocument, sel: RenderedSelection): vscode.Range | null {
  const blockRange = blockLinesToRange(doc, sel.blockStartLine, sel.blockEndLine);
  if (!blockRange) {
    return null;
  }

  if (!sel.spansMultipleBlocks && sel.quote) {
    const blockText = doc.getText(blockRange);
    const idx = locate(blockText, sel.quote, sel.before, sel.after);
    if (idx >= 0) {
      const startOffset = doc.offsetAt(blockRange.start) + idx;
      return new vscode.Range(doc.positionAt(startOffset), doc.positionAt(startOffset + sel.quote.length));
    }
  }
  return blockRange;
}
