// StoredThread → webview WireThread，以及 Mermaid fence 定位（VS Code / 浏览器 host 共用）。
import { relocate } from '../anchor';
import type { StoredThread } from '../types';
import type { TextModel } from '../text-model';
import type { WireThread } from './messages';

export function mermaidBlockEndLine(doc: TextModel, startLine: number): number {
  const opening = /^(?: {0,3})(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i.exec(doc.lineAt(startLine).text);
  if (!opening) {
    return startLine + 1;
  }
  const marker = opening[1][0];
  const minimumLength = opening[1].length;
  for (let line = startLine + 1; line < doc.lineCount; line++) {
    const closing = new RegExp(`^(?: {0,3})${marker}{${minimumLength},}\\s*$`).exec(doc.lineAt(line).text);
    if (closing) {
      return line + 1;
    }
  }
  return doc.lineCount;
}

export function mermaidBlockNear(
  doc: TextModel,
  line: number,
): { startLine: number; endLine: number } | null {
  const blocks: Array<{ startLine: number; endLine: number }> = [];
  for (let candidate = 0; candidate < doc.lineCount; candidate++) {
    if (!/^(?: {0,3})(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i.test(doc.lineAt(candidate).text)) {
      continue;
    }
    const endLine = mermaidBlockEndLine(doc, candidate);
    blocks.push({ startLine: candidate, endLine });
    candidate = Math.max(candidate, endLine - 1);
  }
  return blocks.find((block) => block.startLine <= line && line < block.endLine) ?? null;
}

/**
 * StoredThread → webview 用的精简表示。
 * 传入当前 doc 时对划词锚点做读时 relocate：内容变动后高亮跟着原文走（不写回存储）。
 * relocate 失败（原文被完整删除/替换）→ orphaned；Mermaid 节点可降级到整图。
 */
export function toWire(t: StoredThread, doc?: TextModel): WireThread {
  let { startLine } = t.anchor;
  let { endLine } = t.anchor;
  let orphaned = false;
  if (doc && t.anchor.kind === 'selection') {
    const r = relocate(doc, t.anchor);
    if (!r) {
      if (t.anchor.target?.kind === 'mermaid-node') {
        const block = mermaidBlockNear(doc, t.anchor.startLine);
        if (!block) {
          orphaned = true;
        } else {
          startLine = block.startLine;
          endLine = block.endLine - 1;
        }
      } else {
        orphaned = true;
      }
    } else {
      startLine = r.start.line;
      endLine =
        t.anchor.target?.kind === 'mermaid-diagram' ? mermaidBlockEndLine(doc, startLine) - 1 : r.end.line;
    }
  }
  return {
    id: t.id,
    status: t.status,
    kind: t.anchor.kind,
    blockStartLine: startLine,
    blockEndLine: endLine + 1,
    quote: t.anchor.quote,
    rendered: t.anchor.rendered,
    target: t.anchor.target,
    orphaned: orphaned || undefined,
    comments: t.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt })),
  };
}
