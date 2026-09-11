// Webview → host message validation (no vscode). Extracted so create-path
// rejects can be tested without a WebviewPanel.
import type { RenderedSelection, WebviewToHost } from './messages';

export const MAX_RESOURCE_REQUESTS = 100;
export const MAX_ID_LENGTH = 256;
export const MAX_COMMENT_LENGTH = 100_000;
export const MAX_SELECTION_QUOTE_LENGTH = 200_000;
export const MAX_SELECTION_CONTEXT_LENGTH = 1_000;
export const MAX_LABEL_LENGTH = 500;
export const MAX_LINK_LENGTH = 4_096;

export const CREATE_REJECTED_MESSAGE = '评论未能提交：选区或正文无效，请重新划词后再试。';

const CREATE_TYPES = new Set([
  'createThread',
  'createBlockThread',
  'createMermaidNodeThread',
  'createDocThread',
  'reply',
]);

/** True when the payload looks like a comment-create/reply intent (even if invalid). */
export function isCreateIntent(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      typeof (value as { type: unknown }).type === 'string' &&
      CREATE_TYPES.has((value as { type: string }).type),
  );
}

/**
 * Normalize a rendered selection so a missing/equal `data-end-line` still maps.
 * markdown-it maps are [start, end); a collapsed range becomes start+1.
 */
export function normalizeRenderedSelection(selection: RenderedSelection): RenderedSelection {
  const blockStartLine = Number.isFinite(selection.blockStartLine)
    ? Math.max(0, Math.floor(selection.blockStartLine))
    : 0;
  let blockEndLine = Number.isFinite(selection.blockEndLine)
    ? Math.floor(selection.blockEndLine)
    : blockStartLine + 1;
  if (blockEndLine <= blockStartLine) {
    blockEndLine = blockStartLine + 1;
  }
  return { ...selection, blockStartLine, blockEndLine };
}

export function normalizeLineSpan(startLine: number, endLine: number): { startLine: number; endLine: number } {
  const start = Number.isFinite(startLine) ? Math.max(0, Math.floor(startLine)) : 0;
  let end = Number.isFinite(endLine) ? Math.floor(endLine) : start + 1;
  if (end <= start) {
    end = start + 1;
  }
  return { startLine: start, endLine: end };
}

export function isWebviewMessage(value: unknown): value is WebviewToHost {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') {
    return false;
  }
  const message = value as Record<string, unknown>;
  const hasBoundedString = (key: string, maximum: number) =>
    typeof message[key] === 'string' && (message[key] as string).length <= maximum;
  const hasId = (key: string) => hasBoundedString(key, MAX_ID_LENGTH);
  const hasComment = (key: string) => hasBoundedString(key, MAX_COMMENT_LENGTH);
  const hasFiniteNumber = (key: string) => typeof message[key] === 'number' && Number.isFinite(message[key]);
  const hasNonNegativeInteger = (key: string) =>
    typeof message[key] === 'number' && Number.isInteger(message[key]) && (message[key] as number) >= 0;
  switch (message.type) {
    case 'ready':
      return true;
    case 'createThread':
      if (!hasComment('text') || !message.selection || typeof message.selection !== 'object') {
        return false;
      }
      {
        const selection = message.selection as Record<string, unknown>;
        // Allow end <= start (missing data-end-line → 0). Host normalizes to start+1.
        return (
          typeof selection.blockStartLine === 'number' &&
          Number.isInteger(selection.blockStartLine) &&
          selection.blockStartLine >= 0 &&
          typeof selection.blockEndLine === 'number' &&
          Number.isInteger(selection.blockEndLine) &&
          typeof selection.quote === 'string' &&
          selection.quote.length <= MAX_SELECTION_QUOTE_LENGTH &&
          typeof selection.before === 'string' &&
          selection.before.length <= MAX_SELECTION_CONTEXT_LENGTH &&
          typeof selection.after === 'string' &&
          selection.after.length <= MAX_SELECTION_CONTEXT_LENGTH &&
          typeof selection.spansMultipleBlocks === 'boolean'
        );
      }
    case 'createBlockThread':
      return (
        hasComment('text') &&
        hasBoundedString('label', MAX_LABEL_LENGTH) &&
        message.target === 'mermaid-diagram' &&
        hasNonNegativeInteger('startLine') &&
        hasNonNegativeInteger('endLine')
      );
    case 'createMermaidNodeThread':
      return (
        hasComment('text') &&
        hasBoundedString('label', MAX_LABEL_LENGTH) &&
        hasBoundedString('nodeId', MAX_ID_LENGTH) &&
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(message.nodeId as string) &&
        hasNonNegativeInteger('startLine') &&
        hasNonNegativeInteger('endLine')
      );
    case 'createDocThread':
      return hasComment('text');
    case 'reply':
      return hasId('threadId') && hasComment('text');
    case 'resolve':
      return hasId('threadId') && typeof message.resolved === 'boolean';
    case 'deleteThread':
    case 'revealSource':
      return hasId('threadId');
    case 'editComment':
    case 'deleteComment':
      return (
        hasId('threadId') && hasId('commentId') && (message.type === 'deleteComment' || hasComment('text'))
      );
    case 'resolveResources':
      return (
        hasId('requestId') &&
        Array.isArray(message.sources) &&
        message.sources.length <= MAX_RESOURCE_REQUESTS &&
        message.sources.every((source) => typeof source === 'string' && source.length <= MAX_LINK_LENGTH)
      );
    case 'openLink':
      return hasBoundedString('href', MAX_LINK_LENGTH);
    case 'copyImageFallback':
    case 'openImage':
      return hasBoundedString('source', MAX_LINK_LENGTH);
    case 'revealSourceLine':
    case 'previewScroll':
      return hasFiniteNumber('line');
    case 'copySkillPrompt':
      return true;
    default:
      return false;
  }
}
