// VS Code 薄壳：把 vscode.TextDocument / Range 换成 core/anchor 的 text + offset。
// 锚定与重定位的逻辑都在 core/anchor.ts，这里只做坐标系转换。
import * as vscode from 'vscode';
import type { StoredAnchor } from './types';
import type { RenderedSelection } from './preview/messages';
import * as core from './core/anchor';

export const { CONTEXT_LEN } = core;

function toRange(doc: vscode.TextDocument, r: core.TextRange): vscode.Range {
  return new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));
}

/** 从一个源码 Range 构建锚点（document 类型锚到文件顶部）。 */
export function buildAnchorFromRange(
  doc: vscode.TextDocument,
  range: vscode.Range,
  kind: 'selection' | 'document',
): StoredAnchor {
  return core.buildAnchor(
    doc.getText(),
    { start: doc.offsetAt(range.start), end: doc.offsetAt(range.end) },
    kind,
  );
}

/** 把存储锚点重新映射到当前文档；返回 null 表示原文已删除、锚点失效。 */
export function relocate(doc: vscode.TextDocument, a: StoredAnchor): vscode.Range | null {
  const r = core.relocate(doc.getText(), a);
  return r && toRange(doc, r);
}

/** 把渲染块的源码行范围转换成实体 Range。endLineExclusive 为排他行号。 */
export function blockLinesToRange(
  doc: vscode.TextDocument,
  startLine: number,
  endLineExclusive: number,
): vscode.Range | null {
  const r = core.blockLinesToRange(doc.getText(), startLine, endLineExclusive);
  return r && toRange(doc, r);
}

/** 把 webview 上报的渲染选区翻译成源码 Range。 */
export function mapRenderedSelectionToRange(
  doc: vscode.TextDocument,
  sel: RenderedSelection,
): vscode.Range | null {
  const r = core.mapRenderedSelectionToRange(doc.getText(), sel);
  return r && toRange(doc, r);
}
