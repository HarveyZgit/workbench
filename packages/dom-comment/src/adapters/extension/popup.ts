import { canonicalizeUrl, isHttpUrl } from '../../core/identity.js';
import { postToBackground } from './messages.js';

const PLUS =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const X =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const COPY =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12"/></svg>';
const CHECK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';

async function activeTab(): Promise<{ id?: number; url?: string } | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setPrompt(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

async function render(): Promise<void> {
  const tab = await activeTab();
  const mode = await chrome.storage.session.get('annotationMode');
  const btn = document.getElementById('toggle')!;
  const on = Boolean(mode.annotationMode);
  btn.className = on ? 'btn btn-outline w-full' : 'btn btn-primary w-full';
  btn.innerHTML = `${on ? X : PLUS}<span>${on ? '停止标记' : '开始标记'}</span>`;
  const tabId = tab?.id ?? 0;
  setPrompt('tabPrompt', `/dom-comment tabid:${tabId}`);
  const href = tab?.url || '';
  const pageCard = document.getElementById('pageCard')!;
  const pageDesc = document.getElementById('pageDesc')!;
  const pageCopy = pageCard.querySelector<HTMLButtonElement>('.copy');
  if (!isHttpUrl(href)) {
    setPrompt('pagePrompt', '');
    pageDesc.textContent = '当前页不能标注';
    pageCard.classList.add('muted');
    if (pageCopy) {
      pageCopy.disabled = true;
    }
    return;
  }
  pageCard.classList.remove('muted');
  pageDesc.textContent = '查看此页面上的评论';
  if (pageCopy) {
    pageCopy.disabled = false;
  }
  const url = canonicalizeUrl(href);
  setPrompt('pagePrompt', `/dom-comment tabid:${tabId} url:${url}`);
}

document.getElementById('toggle')!.addEventListener('click', async () => {
  const mode = await chrome.storage.session.get('annotationMode');
  postToBackground({ type: 'SET_MODE_REQUEST', on: !mode.annotationMode });
  window.close();
});

document.querySelectorAll<HTMLButtonElement>('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-copy');
    const pre = id ? document.getElementById(id)?.textContent : '';
    const label = btn.closest('.card')?.getAttribute('data-label') ?? '';
    if (!pre) {
      return;
    }
    await navigator.clipboard.writeText(`${label}\n${pre}`);
    btn.innerHTML = CHECK;
    window.setTimeout(() => {
      btn.innerHTML = COPY;
    }, 1500);
  });
});

void render();
