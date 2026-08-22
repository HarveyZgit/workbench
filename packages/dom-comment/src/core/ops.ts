import { randomUUID } from 'node:crypto';
import type { StoredAnchor, StoredComment, StoredPage, StoredTabFile, StoredThread } from './types.js';

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
  const thread: StoredThread = {
    id: randomUUID(),
    anchor,
    status: 'open',
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
  let page = tab.pages[url];
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
