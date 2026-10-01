// Obsidian 适配器里与宿主无关的纯逻辑（不 import obsidian / DOM / node），便于直接单测。
import { buildAnchor, mapRenderedSelectionToRange } from '../../core/anchor';
import type { RenderedSelection } from '../../preview/messages';
import type { StoredAnchor } from '../../types';

// ─── 标签：写进第一条评论正文的前缀 `[标签] `，不改 schema ─────────────────

export const LABELS = ['不清楚', '有误', '删', '其他'] as const;

const LABEL_RE = new RegExp(`^\\[(${LABELS.join('|')})\\]\\s*`);

export function formatBody(label: string | null, body: string): string {
  const text = body.trim();
  return label ? `[${label}] ${text}` : text;
}

export function parseLabel(body: string): { label: string | null; text: string } {
  const m = LABEL_RE.exec(body);
  return m ? { label: m[1], text: body.slice(m[0].length) } : { label: null, text: body };
}

// ─── 展示辅助 ──────────────────────────────────────────────────────

const QUOTE_CLIP = 40;

export function clip(s: string, max = QUOTE_CLIP): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 剥掉行首 markdown 标记（#、-、*、+、>、有序号），让整块引用更干净（同 VS Code 预览侧栏）。 */
function stripMarks(s: string): string {
  return s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '');
}

/** 卡片上的引用文字：渲染态引用优先，全文评论固定文案（同 VS Code 预览侧栏）。 */
export function quoteLabel(anchor: StoredAnchor): string {
  if (anchor.kind === 'document') {
    return '📄 全文';
  }
  return clip(anchor.rendered?.quote || stripMarks(anchor.quote)) || '（整段）';
}

/**
 * 失联判定，与 CLI `list` 一致：划词锚点的源码引用已不在正文里。
 * Mermaid 等带 target 的锚点在 Obsidian 里不渲染、也不判定失联（CLI 仍会判定）。
 */
export function isOrphaned(text: string, anchor: StoredAnchor): boolean {
  if (anchor.kind === 'document' || !anchor.quote || anchor.target) {
    return false;
  }
  return !text.includes(anchor.quote);
}

// ─── 渲染选区 → 锚点 ───────────────────────────────────────────────

/** 与 VS Code 预览 `handleCreate` 相同：翻译选区 → 构建锚点 → 附渲染态快照。 */
export function anchorFromRenderedSelection(text: string, sel: RenderedSelection): StoredAnchor | null {
  const range = mapRenderedSelectionToRange(text, sel);
  if (!range) {
    return null;
  }
  const anchor = buildAnchor(text, range, 'selection');
  if (sel.quote) {
    anchor.rendered = { quote: sel.quote, before: sel.before, after: sel.after };
  }
  return anchor;
}

// ─── getSectionInfo 行号校验 ───────────────────────────────────────

export interface SectionInfoLike {
  text: string;
  lineStart: number;
  lineEnd: number;
}

const EOL_RE = /\r\n|\r|\n/;

export function normalizeEol(s: string): string {
  return s.split(EOL_RE).join('\n');
}

/** 文首 YAML front matter 占的行数（含两条 `---` 行）；没有则为 0。 */
export function frontmatterLineCount(text: string): number {
  const lines = text.split(EOL_RE);
  if (lines[0]?.trimEnd() !== '---') {
    return 0;
  }
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === '---' || t === '...') {
      return i + 1;
    }
  }
  return 0;
}

/**
 * 把 `getSectionInfo` 的行号换算成**文件源码**行号（0 基，含 front matter）。
 *
 * Obsidian 的 d.ts 没写明 lineStart 相对谁。这里不赌：
 * 1. `info.text` 就是整篇源码 → 行号直接索引它，即文件行号；
 * 2. `info.text` 只是该块片段 → 在文件里按「原样 / 加 front matter 行数」两种偏移逐一核对内容，对上才采用；
 * 3. 都对不上（文件刚被改、或 API 行为与假设不符）→ null，由调用方提示，绝不乱锚。
 */
export function resolveSectionLines(
  fileText: string,
  info: SectionInfoLike,
): { startLine: number; endLine: number } | null {
  const { lineStart, lineEnd } = info;
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd < lineStart) {
    return null;
  }
  const fileLines = fileText.split(EOL_RE);
  const infoText = normalizeEol(info.text);
  if (infoText === fileLines.join('\n')) {
    return lineEnd < fileLines.length ? { startLine: lineStart, endLine: lineEnd } : null;
  }
  const offsets = [0, frontmatterLineCount(fileText)];
  for (const off of offsets) {
    const slice = fileLines.slice(lineStart + off, lineEnd + off + 1).join('\n');
    if (slice === infoText) {
      return { startLine: lineStart + off, endLine: lineEnd + off };
    }
  }
  return null;
}

// ─── 编辑视图 ──────────────────────────────────────────────────────

/**
 * CodeMirror 把 CRLF 归一成 \n，缓冲区 offset 与磁盘不同，所以编辑视图只用行列。
 * 缓冲区与磁盘内容一致（忽略换行符差异）时用磁盘原文（保留 CRLF，前后文才能与 CLI 对上），否则用缓冲区。
 */
export function pickSourceText(editorText: string, diskText: string): string {
  return normalizeEol(editorText) === normalizeEol(diskText) ? diskText : editorText;
}

/** 无 metadataCache 时的兜底：光标所在的「空行分隔段落」行范围（0 基，闭区间）。 */
export function paragraphLines(text: string, line: number): { startLine: number; endLine: number } {
  const lines = text.split(EOL_RE);
  const at = Math.min(Math.max(0, line), lines.length - 1);
  let start = at;
  let end = at;
  while (start > 0 && lines[start - 1].trim() !== '') {
    start--;
  }
  while (end + 1 < lines.length && lines[end + 1].trim() !== '') {
    end++;
  }
  return { startLine: start, endLine: end };
}
