// 编辑视图（Live Preview / 源码模式）：直接用编辑器选区或光标所在块建草稿，等价于 VS Code 源码内联评论。
import { Notice } from 'obsidian';
import type { MarkdownView, TFile } from 'obsidian';
import { buildAnchor, lineStarts, offsetAt } from '../../core/anchor';
import type { RenderedSelection } from '../../preview/messages';
import type { Draft } from './draft';
import type MarkdownCommentPlugin from './main';
import { anchorFromRenderedSelection, clip, normalizeEol, paragraphLines, pickSourceText } from './model';

/** CodeMirror 的 offset 把 CRLF 当 1 个字符，与磁盘不一致，所以这里只取行列，再换算到源码文本。 */
async function sourceTextOf(plugin: MarkdownCommentPlugin, view: MarkdownView, file: TFile): Promise<string> {
  const disk = await plugin.readText(file);
  return pickSourceText(view.editor.getValue(), disk);
}

export async function draftFromEditorSelection(
  plugin: MarkdownCommentPlugin,
  view: MarkdownView,
): Promise<Draft | null> {
  const { file, editor } = view;
  if (!file) {
    return null;
  }
  const selected = editor.getSelection();
  if (!selected.trim()) {
    new Notice('请先选中要评论的文字');
    return null;
  }
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  const text = await sourceTextOf(plugin, view, file);
  const starts = lineStarts(text);
  const start = offsetAt(text, starts, from.line, from.ch);
  const end = offsetAt(text, starts, to.line, to.ch);
  if (normalizeEol(text.slice(start, end)) !== normalizeEol(selected)) {
    new Notice('无法把选区定位回源码，请重新选择');
    return null;
  }
  return {
    file,
    preview: clip(selected),
    sourceText: text,
    build: (t) => buildAnchor(t, { start, end }, 'selection'),
    label: null,
    body: '',
  };
}

/** 光标所在块：优先用 metadataCache 的 section（表、callout、代码块都准），没有缓存时退回空行分段。 */
export async function draftFromEditorBlock(
  plugin: MarkdownCommentPlugin,
  view: MarkdownView,
): Promise<Draft | null> {
  const { file, editor } = view;
  if (!file) {
    return null;
  }
  const { line } = editor.getCursor('from');
  const text = await sourceTextOf(plugin, view, file);
  const section = plugin.app.metadataCache
    .getFileCache(file)
    ?.sections?.find((s) => s.position.start.line <= line && line <= s.position.end.line);
  const { startLine, endLine } = section
    ? { startLine: section.position.start.line, endLine: section.position.end.line }
    : paragraphLines(text, line);
  const selection: RenderedSelection = {
    blockStartLine: startLine,
    blockEndLine: endLine + 1,
    quote: '',
    before: '',
    after: '',
    spansMultipleBlocks: true,
  };
  const anchor = anchorFromRenderedSelection(text, selection);
  if (!anchor) {
    new Notice('无法定位光标所在的块');
    return null;
  }
  return {
    file,
    preview: clip(anchor.quote),
    sourceText: text,
    build: (t) => anchorFromRenderedSelection(t, selection),
    label: null,
    body: '',
  };
}

export function documentDraft(file: TFile): Draft {
  return {
    file,
    preview: '全文评论',
    build: (t) => buildAnchor(t, { start: 0, end: 0 }, 'document'),
    label: null,
    body: '',
  };
}
