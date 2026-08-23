import { canonicalizeUrl, isHttpUrl } from '../../core/identity.js';
import { formatAgentPrompt } from '../../core/markdown.js';
import { postToBackground } from './messages.js';

async function activeTab(): Promise<{ id?: number; url?: string } | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function promptFor(tabId: number, href: string): string {
  if (isHttpUrl(href)) {
    return formatAgentPrompt(tabId, canonicalizeUrl(href));
  }
  return formatAgentPrompt(tabId);
}

async function paint(): Promise<void> {
  const mode = await chrome.storage.session.get('annotationMode');
  const on = Boolean(mode.annotationMode);
  const toggle = document.getElementById('toggle')!;
  toggle.className = on ? 'btn btn-ghost' : 'btn btn-primary';
  toggle.textContent = on ? '停止标记' : '开始标记';
}

document.getElementById('toggle')!.addEventListener('click', async () => {
  const mode = await chrome.storage.session.get('annotationMode');
  postToBackground({ type: 'SET_MODE_REQUEST', on: !mode.annotationMode });
  window.close();
});

document.getElementById('copy')!.addEventListener('click', async () => {
  const tab = await activeTab();
  const text = promptFor(tab?.id ?? 0, tab?.url || '');
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById('copy')!;
  btn.textContent = '已复制';
  window.setTimeout(() => {
    btn.textContent = '复制 skill prompt';
  }, 1500);
});

void paint();
