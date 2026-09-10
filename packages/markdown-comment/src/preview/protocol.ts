// Webview ↔ host 消息校验（VS Code panel 与本地浏览器 server 共用）。
import type { WebviewToHost } from './messages';

export const MAX_RESOURCE_REQUESTS = 100;
export const MAX_ID_LENGTH = 256;
export const MAX_COMMENT_LENGTH = 100_000;
export const MAX_SELECTION_QUOTE_LENGTH = 200_000;
export const MAX_SELECTION_CONTEXT_LENGTH = 1_000;
export const MAX_LABEL_LENGTH = 500;
export const MAX_LINK_LENGTH = 4_096;

export const COMMENT_MUTATION_TYPES = [
  'createThread',
  'createBlockThread',
  'createMermaidNodeThread',
  'createDocThread',
  'reply',
  'editComment',
  'resolve',
  'deleteComment',
  'deleteThread',
] as const;

export type CommentMutationType = (typeof COMMENT_MUTATION_TYPES)[number];

export function isCommentMutation(type: string): type is CommentMutationType {
  return (COMMENT_MUTATION_TYPES as readonly string[]).includes(type);
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
        return (
          typeof selection.blockStartLine === 'number' &&
          Number.isInteger(selection.blockStartLine) &&
          selection.blockStartLine >= 0 &&
          typeof selection.blockEndLine === 'number' &&
          Number.isInteger(selection.blockEndLine) &&
          selection.blockEndLine > selection.blockStartLine &&
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
        hasNonNegativeInteger('endLine') &&
        (message.endLine as number) > (message.startLine as number)
      );
    case 'createMermaidNodeThread':
      return (
        hasComment('text') &&
        hasBoundedString('label', MAX_LABEL_LENGTH) &&
        hasBoundedString('nodeId', MAX_ID_LENGTH) &&
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(message.nodeId as string) &&
        hasNonNegativeInteger('startLine') &&
        hasNonNegativeInteger('endLine') &&
        (message.endLine as number) > (message.startLine as number)
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
