import { buildAnchor } from '../core/anchor.js';
import { canonicalizeUrl } from '../core/identity.js';
import { createThread, editComment, reply, resolve, updateRelocate } from '../core/ops.js';
import type { CapturedTarget, StoredTabFile, StoredThread } from '../core/types.js';
import {
  currentSession,
  findThread,
  loadTab,
  prepareTab,
  reclaimLiveTabs,
  resolveStorageDir,
  saveTab,
  screenshotRelPath,
  writeScreenshot,
  writeSession,
} from '../storage/index.js';

export type HostRequest =
  | { id: string; op: 'ping' }
  | { id: string; op: 'hello' }
  | { id: string; op: 'beginSession'; sessionId: string }
  | { id: string; op: 'reclaimTabs'; tabIds: number[]; sessionId: string }
  | { id: string; op: 'loadTab'; tabId: number }
  | {
      id: string;
      op: 'createThread';
      tabId: number;
      url: string;
      title: string;
      captured: CapturedTarget;
      body: string;
      screenshotPngBase64: string;
    }
  | { id: string; op: 'reply'; threadId: string; body: string; author: 'user' | 'agent' }
  | { id: string; op: 'editComment'; threadId: string; commentId: string; body: string }
  | { id: string; op: 'resolve'; threadId: string }
  | {
      id: string;
      op: 'updateRelocate';
      tabId: number;
      url: string;
      updates: { threadId: string; state: 'located' | 'orphaned' }[];
    }
  | { id: string; op: 'focusTab'; tabId: number };

export type HostResponse =
  | { id: string; ok: true; tab?: StoredTabFile; thread?: StoredThread; sessionId?: string }
  | { id: string; ok: false; error: string };

function assertTabId(tabId: unknown): number {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId) || tabId <= 0 || !Number.isInteger(tabId)) {
    throw new Error('invalid tabId');
  }
  return tabId;
}

export function handleRequest(req: HostRequest, storageDir = resolveStorageDir()): HostResponse {
  try {
    switch (req.op) {
      case 'ping':
        return { id: req.id, ok: true };
      case 'hello':
        return { id: req.id, ok: true, sessionId: currentSession(storageDir) };
      case 'beginSession': {
        if (!req.sessionId) {
          throw new Error('missing sessionId');
        }
        writeSession(storageDir, req.sessionId);
        return { id: req.id, ok: true, sessionId: req.sessionId };
      }
      case 'reclaimTabs': {
        const sessionId = req.sessionId || currentSession(storageDir);
        const tabIds = Array.isArray(req.tabIds) ? req.tabIds : [];
        reclaimLiveTabs(storageDir, tabIds, sessionId);
        return { id: req.id, ok: true, sessionId };
      }
      case 'loadTab': {
        const tabId = assertTabId(req.tabId);
        const tab = loadTab(storageDir, tabId);
        return { id: req.id, ok: true, tab };
      }
      case 'createThread': {
        const tabId = assertTabId(req.tabId);
        const url = canonicalizeUrl(req.url);
        const session = currentSession(storageDir);
        const tab = prepareTab(storageDir, tabId, session);
        tab.sessionId = session;
        const anchor = buildAnchor(req.captured, req.title || '');
        const { thread } = createThread(tab, url, req.title, anchor, req.body, '');
        if (req.screenshotPngBase64) {
          const rel = screenshotRelPath(url, thread.id);
          writeScreenshot(storageDir, tabId, rel, Buffer.from(req.screenshotPngBase64, 'base64'));
          thread.screenshot = rel;
        }
        saveTab(storageDir, tab);
        return { id: req.id, ok: true, thread, tab };
      }
      case 'reply': {
        const hit = findThread(storageDir, req.threadId);
        if (!hit) {
          throw new Error('thread not found');
        }
        reply(hit.tab, hit.thread.id, { author: req.author, body: req.body });
        saveTab(storageDir, hit.tab);
        return { id: req.id, ok: true, thread: hit.thread, tab: hit.tab };
      }
      case 'editComment': {
        const hit = findThread(storageDir, req.threadId);
        if (!hit) {
          throw new Error('thread not found');
        }
        editComment(hit.tab, hit.thread.id, req.commentId, req.body);
        saveTab(storageDir, hit.tab);
        return { id: req.id, ok: true, thread: hit.thread, tab: hit.tab };
      }
      case 'resolve': {
        const hit = findThread(storageDir, req.threadId);
        if (!hit) {
          throw new Error('thread not found');
        }
        resolve(hit.tab, hit.thread.id);
        saveTab(storageDir, hit.tab);
        return { id: req.id, ok: true, thread: hit.thread, tab: hit.tab };
      }
      case 'updateRelocate': {
        const tabId = assertTabId(req.tabId);
        const tab = loadTab(storageDir, tabId);
        updateRelocate(tab, req.updates, new Date().toISOString());
        saveTab(storageDir, tab);
        return { id: req.id, ok: true, tab };
      }
      case 'focusTab':
        return { id: req.id, ok: false, error: 'focusTab must be handled by the extension' };
      default:
        return { id: (req as HostRequest).id, ok: false, error: 'unknown op' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: req.id, ok: false, error: message };
  }
}

export function encodeFrame(obj: unknown): Buffer {
  const json = Buffer.from(`${JSON.stringify(obj)}`, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function tryDecodeFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const size = buffer.readUInt32LE(offset);
    if (buffer.length - offset - 4 < size) {
      break;
    }
    offset += 4;
    const json = buffer.subarray(offset, offset + size).toString('utf8');
    offset += size;
    messages.push(JSON.parse(json));
  }
  return { messages, rest: buffer.subarray(offset) };
}
