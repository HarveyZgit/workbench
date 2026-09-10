// 把 webview 评论意图应用到 StoredDocument（VS Code panel 与本地浏览器 server 共用）。
import { randomUUID } from 'node:crypto';
import { buildAnchorFromRange, mapRenderedSelectionToRange } from '../anchor';
import { PlainTextDocument } from '../text-model';
import type { StoredDocument, StoredThread } from '../types';
import type { WebviewToHost } from './messages';
import { isCommentMutation } from './protocol';

export interface MutationResult {
  changed: boolean;
  warning?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function userComment(body: string): StoredThread['comments'][number] {
  return { id: randomUUID(), author: 'user', body, createdAt: nowIso() };
}

export function applyCommentMutation(
  stored: StoredDocument,
  sourceText: string,
  msg: WebviewToHost,
): MutationResult {
  if (!isCommentMutation(msg.type)) {
    return { changed: false };
  }
  const model = PlainTextDocument.fromString(sourceText);

  switch (msg.type) {
    case 'createThread': {
      if (!msg.text.trim()) {
        return { changed: false };
      }
      if (!sourceText) {
        return { changed: false, warning: '源 Markdown 文件无法读取（可能已删除或移动），无法创建评论' };
      }
      const range = mapRenderedSelectionToRange(model, msg.selection);
      if (!range) {
        return { changed: false, warning: '无法把这段选区定位回源码' };
      }
      const anchor = buildAnchorFromRange(model, range, 'selection');
      anchor.rendered = {
        quote: msg.selection.quote,
        before: msg.selection.before,
        after: msg.selection.after,
      };
      stored.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [userComment(msg.text)],
      });
      return { changed: true };
    }
    case 'createBlockThread': {
      if (!msg.text.trim()) {
        return { changed: false };
      }
      if (model.lineCount === 0) {
        return { changed: false, warning: '源 Markdown 文件无法读取，无法创建图表评论' };
      }
      const safeStartLine = Math.min(Math.max(0, msg.startLine), Math.max(0, model.lineCount - 1));
      const {range} = model.lineAt(safeStartLine);
      const anchor = buildAnchorFromRange(model, range, 'selection');
      anchor.rendered = { quote: msg.label, before: '', after: '' };
      anchor.target = { kind: msg.target };
      stored.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [userComment(msg.text)],
      });
      return { changed: true };
    }
    case 'createMermaidNodeThread': {
      if (!msg.text.trim()) {
        return { changed: false };
      }
      if (model.lineCount === 0) {
        return { changed: false, warning: '源 Markdown 文件无法读取，无法创建节点评论' };
      }
      const safeStartLine = Math.min(Math.max(0, msg.startLine), Math.max(0, model.lineCount - 1));
      const {range} = model.lineAt(safeStartLine);
      const anchor = buildAnchorFromRange(model, range, 'selection');
      anchor.rendered = { quote: msg.label, before: '', after: '' };
      anchor.target = { kind: 'mermaid-node', nodeId: msg.nodeId };
      stored.threads.push({
        id: randomUUID(),
        anchor,
        status: 'open',
        comments: [userComment(msg.text)],
      });
      return { changed: true };
    }
    case 'createDocThread': {
      if (!msg.text) {
        return { changed: false };
      }
      stored.threads.push({
        id: randomUUID(),
        anchor: {
          kind: 'document',
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: 0,
          quote: '',
          before: '',
          after: '',
        },
        status: 'open',
        comments: [userComment(msg.text)],
      });
      return { changed: true };
    }
    case 'reply': {
      const thread = stored.threads.find((x) => x.id === msg.threadId);
      if (!thread) {
        return { changed: false };
      }
      thread.comments.push(userComment(msg.text));
      return { changed: true };
    }
    case 'editComment': {
      if (!msg.text.trim()) {
        return { changed: false };
      }
      const comment = stored.threads
        .find((x) => x.id === msg.threadId)
        ?.comments.find((y) => y.id === msg.commentId);
      if (!comment) {
        return { changed: false };
      }
      comment.body = msg.text;
      return { changed: true };
    }
    case 'resolve': {
      const thread = stored.threads.find((x) => x.id === msg.threadId);
      if (!thread) {
        return { changed: false };
      }
      thread.status = msg.resolved ? 'resolved' : 'open';
      return { changed: true };
    }
    case 'deleteComment': {
      const thread = stored.threads.find((x) => x.id === msg.threadId);
      if (!thread) {
        return { changed: false };
      }
      thread.comments = thread.comments.filter((c) => c.id !== msg.commentId);
      stored.threads = stored.threads.filter((x) => x.comments.length > 0);
      return { changed: true };
    }
    case 'deleteThread': {
      const before = stored.threads.length;
      stored.threads = stored.threads.filter((x) => x.id !== msg.threadId);
      return { changed: stored.threads.length !== before };
    }
    default:
      return { changed: false };
  }
}
