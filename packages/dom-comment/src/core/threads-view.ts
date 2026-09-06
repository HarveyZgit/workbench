import type { StoredTabFile, StoredThread } from './types.js';

export interface ThreadListItem {
  pageUrl: string;
  thread: StoredThread;
}

/** Collect threads for the current page, or every page in the tab file. */
export function threadsInScope(tab: StoredTabFile, pageUrl: string, allPages: boolean): ThreadListItem[] {
  const out: ThreadListItem[] = [];
  for (const [url, page] of Object.entries(tab.pages)) {
    if (!allPages && url !== pageUrl) {
      continue;
    }
    for (const thread of page.threads) {
      out.push({ pageUrl: url, thread });
    }
  }
  return out;
}
