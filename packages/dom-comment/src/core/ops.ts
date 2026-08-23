import { randomUUID } from 'node:crypto';
import {
  isPublishedThread,
  type StoredAnchor,
  type StoredComment,
  type StoredPage,
  type StoredTabFile,
  type StoredThread,
} from './types.js';

function assertNonEmptyBody(body: string): string {
  const t = body.trim();
  if (!t) {
    throw new Error('empty body');
  }
  return t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function findThreadInTab(
  tab: StoredTabFile,
  threadId: string,
): { page: StoredPage; thread: StoredThread } | null {
  for (const page of Object.values(tab.pages)) {
    const thread = page.threads.find((item) => item.id === threadId);
    if (thread) {
      return { page, thread };
    }
  }
  return null;
}

function nextNumber(page: StoredPage | undefined): number {
  if (!page) {
    return 1;
  }
  let max = 0;
  for (const thread of page.threads) {
    if (thread.status === 'resolved') {
      continue;
    }
    if (thread.number > max) {
      max = thread.number;
    }
  }
  return max + 1;
}

export function createThread(
  tab: StoredTabFile,
  url: string,
  title: string | undefined,
  anchor: StoredAnchor,
  body: string,
  screenshotRel: string,
): { tab: StoredTabFile; thread: StoredThread } {
  const text = assertNonEmptyBody(body);
  const createdAt = nowIso();
  let page = tab.pages[url];
  const thread: StoredThread = {
    id: randomUUID(),
    number: nextNumber(page),
    anchor,
    status: 'open',
    visibility: 'published',
    comments: [
      {
        id: randomUUID(),
        author: 'user',
        body: text,
        createdAt,
      },
    ],
    screenshot: screenshotRel,
  };
  if (!page) {
    page = { url, updatedAt: createdAt, threads: [] };
    if (title) {
      page.title = title;
    }
    tab.pages[url] = page;
  } else if (title) {
    page.title = title;
  }
  page.threads.push(thread);
  page.updatedAt = createdAt;
  tab.updatedAt = createdAt;
  return { tab, thread };
}

export function reply(
  tab: StoredTabFile,
  threadId: string,
  input: { author: 'user' | 'agent'; body: string },
): { tab: StoredTabFile; thread: StoredThread } {
  const text = assertNonEmptyBody(input.body);
  const found = findThreadInTab(tab, threadId);
  if (!found) {
    throw new Error(`thread not found: ${threadId}`);
  }
  const comment: StoredComment = {
    id: randomUUID(),
    author: input.author,
    body: text,
    createdAt: nowIso(),
  };
  found.thread.comments.push(comment);
  found.page.updatedAt = comment.createdAt;
  tab.updatedAt = comment.createdAt;
  return { tab, thread: found.thread };
}

export function editComment(
  tab: StoredTabFile,
  threadId: string,
  commentId: string,
  body: string,
): { tab: StoredTabFile; thread: StoredThread } {
  const text = assertNonEmptyBody(body);
  const found = findThreadInTab(tab, threadId);
  if (!found) {
    throw new Error(`thread not found: ${threadId}`);
  }
  const comment = found.thread.comments.find((item) => item.id === commentId);
  if (!comment) {
    throw new Error(`comment not found: ${commentId}`);
  }
  comment.body = text;
  const stamp = nowIso();
  found.page.updatedAt = stamp;
  tab.updatedAt = stamp;
  return { tab, thread: found.thread };
}

export function resolve(tab: StoredTabFile, threadId: string): { tab: StoredTabFile; thread: StoredThread } {
  const found = findThreadInTab(tab, threadId);
  if (!found) {
    throw new Error(`thread not found: ${threadId}`);
  }
  found.thread.status = 'resolved';
  const stamp = nowIso();
  found.page.updatedAt = stamp;
  tab.updatedAt = stamp;
  return { tab, thread: found.thread };
}

export function updateRelocate(
  tab: StoredTabFile,
  updates: { threadId: string; state: 'located' | 'orphaned' }[],
  checkedAt: string,
): StoredTabFile {
  for (const update of updates) {
    const found = findThreadInTab(tab, update.threadId);
    if (!found) {
      continue;
    }
    found.thread.relocateStatus = { state: update.state, checkedAt };
  }
  return tab;
}

export function publishPending(tab: StoredTabFile): { tab: StoredTabFile; batchId: string; count: number } {
  const pending: StoredThread[] = [];
  for (const page of Object.values(tab.pages)) {
    for (const thread of page.threads) {
      if (thread.visibility === 'pending') {
        pending.push(thread);
      }
    }
  }
  if (pending.length === 0) {
    throw new Error('no pending');
  }
  const batchId = randomUUID();
  const stamp = nowIso();
  for (const thread of pending) {
    thread.visibility = 'published';
    thread.batchId = batchId;
  }
  tab.updatedAt = stamp;
  return { tab, batchId, count: pending.length };
}

export function deleteComment(
  tab: StoredTabFile,
  threadId: string,
  commentId: string,
): { tab: StoredTabFile; thread?: StoredThread; removedThread: boolean; screenshot?: string } {
  const found = findThreadInTab(tab, threadId);
  if (!found) {
    throw new Error(`thread not found: ${threadId}`);
  }
  const idx = found.thread.comments.findIndex((item) => item.id === commentId);
  if (idx < 0) {
    throw new Error(`comment not found: ${commentId}`);
  }
  found.thread.comments.splice(idx, 1);
  const stamp = nowIso();
  found.page.updatedAt = stamp;
  tab.updatedAt = stamp;
  if (found.thread.comments.length === 0) {
    const shot = found.thread.screenshot;
    deleteThread(tab, threadId);
    return { tab, removedThread: true, screenshot: shot };
  }
  return { tab, thread: found.thread, removedThread: false };
}

export function deleteThread(
  tab: StoredTabFile,
  threadId: string,
): { tab: StoredTabFile; thread: StoredThread; url: string } {
  for (const [url, page] of Object.entries(tab.pages)) {
    const idx = page.threads.findIndex((item) => item.id === threadId);
    if (idx < 0) {
      continue;
    }
    const thread = page.threads[idx];
    page.threads.splice(idx, 1);
    const stamp = nowIso();
    page.updatedAt = stamp;
    tab.updatedAt = stamp;
    if (page.threads.length === 0) {
      delete tab.pages[url];
    }
    return { tab, thread, url };
  }
  throw new Error(`thread not found: ${threadId}`);
}

export function discardPending(tab: StoredTabFile): { tab: StoredTabFile; removed: StoredThread[] } {
  const removed: StoredThread[] = [];
  for (const [url, page] of Object.entries(tab.pages)) {
    const keep: StoredThread[] = [];
    for (const thread of page.threads) {
      if (thread.visibility === 'pending') {
        removed.push(thread);
      } else {
        keep.push(thread);
      }
    }
    page.threads = keep;
    if (keep.length === 0) {
      delete tab.pages[url];
    }
  }
  if (removed.length > 0) {
    tab.updatedAt = nowIso();
  }
  return { tab, removed };
}

export function pendingThreads(tab: StoredTabFile): StoredThread[] {
  const out: StoredThread[] = [];
  for (const page of Object.values(tab.pages)) {
    for (const thread of page.threads) {
      if (thread.visibility === 'pending') {
        out.push(thread);
      }
    }
  }
  return out;
}

export function publishedOpen(tab: StoredTabFile): StoredThread[] {
  const out: StoredThread[] = [];
  for (const page of Object.values(tab.pages)) {
    for (const thread of page.threads) {
      if (isPublishedThread(thread) && thread.status === 'open') {
        out.push(thread);
      }
    }
  }
  return out;
}
