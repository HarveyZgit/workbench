import { canonicalizeUrl, isHttpUrl } from '../../core/identity.js';
import type { StoredTabFile, StoredThread } from '../../core/types.js';
import { postToBackground, type ExtMessage } from './messages.js';

let tabFile: StoredTabFile | undefined;
let currentUrl = '';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function quote(thread: StoredThread): string {
  return thread.anchor.quote || (thread.anchor.kind === 'area' ? '区域' : thread.anchor.tagName);
}

function render(): void {
  const list = document.getElementById('list')!;
  const all = (document.getElementById('allPages') as HTMLInputElement).checked;
  if (!tabFile) {
    list.innerHTML = '<div class="empty">没有评论</div>';
    return;
  }
  const pages = Object.values(tabFile.pages).filter((p) => all || p.url === currentUrl);
  const items: string[] = [];
  for (const page of pages) {
    for (const thread of page.threads) {
      const kind = thread.anchor.kind === 'area' ? '区域' : thread.anchor.kind === 'text' ? '文字' : '元素';
      const resolved = thread.status === 'resolved' ? ' · 已解决' : '';
      const comments = thread.comments
        .map((c) => `<div>${escapeHtml(c.author)}: ${escapeHtml(c.body)}</div>`)
        .join('');
      const resolveBtn =
        thread.status === 'open'
          ? `<button data-resolve="${thread.id}" type="button">标记已解决</button>`
          : '';
      items.push(
        `<li><div class="meta">[${kind}] ${escapeHtml(quote(thread))}  #${escapeHtml(thread.id.slice(0, 8))}${resolved}</div>${comments}${resolveBtn}</li>`,
      );
    }
  }
  list.innerHTML = items.join('') || '<div class="empty">没有评论</div>';
  list.querySelectorAll<HTMLButtonElement>('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', () => {
      postToBackground({ type: 'RESOLVE_THREAD', threadId: btn.dataset.resolve! });
    });
  });
}

async function load(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }
  currentUrl = tab.url && isHttpUrl(tab.url) ? canonicalizeUrl(tab.url) : '';
  postToBackground({ type: 'LOAD_TAB', tabId: tab.id }, (res) => {
    if (res && res.type === 'LOAD_TAB_RESULT' && res.ok) {
      tabFile = res.tab;
      render();
    }
  });
}

document.getElementById('allPages')!.addEventListener('change', render);
chrome.runtime.onMessage.addListener((msg: ExtMessage) => {
  if (msg.type === 'THREADS_CHANGED' || msg.type === 'LOAD_TAB_RESULT') {
    void load();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void load();
  }
});
void load();
