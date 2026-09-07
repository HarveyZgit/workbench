import assert from 'node:assert/strict';
import { test } from 'node:test';
import { threadsInScope } from '../src/core/threads-view.js';
import type { StoredTabFile, StoredThread } from '../src/core/types.js';

function thread(id: string, status: 'open' | 'resolved' = 'open'): StoredThread {
  return {
    id,
    number: 1,
    status,
    screenshot: 'x.png',
    anchor: {
      kind: 'element',
      css: 'button',
      xpath: '/html/body/button',
      tagName: 'button',
      quote: '保存',
      before: '',
      after: '',
      snapshot: { pageTitle: 't', outerHTML: '<button>保存</button>', textContent: '保存' },
    },
    comments: [{ id: `${id}-c`, author: 'user', body: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }],
  };
}

const tab: StoredTabFile = {
  version: 1,
  tabId: 7,
  sessionId: 's',
  updatedAt: '2026-01-01T00:00:00.000Z',
  pages: {
    'https://ex.test/a': {
      url: 'https://ex.test/a',
      title: 'A',
      updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [thread('t1'), thread('t2', 'resolved')],
    },
    'https://ex.test/b': {
      url: 'https://ex.test/b',
      title: 'B',
      updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [thread('t3')],
    },
  },
};

test('threadsInScope filters to current page by default', () => {
  const items = threadsInScope(tab, 'https://ex.test/a', false);
  assert.deepEqual(
    items.map((i) => i.thread.id),
    ['t1', 't2'],
  );
});

test('threadsInScope can include every page in the tab', () => {
  const items = threadsInScope(tab, 'https://ex.test/a', true);
  assert.deepEqual(
    items.map((i) => i.thread.id),
    ['t1', 't2', 't3'],
  );
});
