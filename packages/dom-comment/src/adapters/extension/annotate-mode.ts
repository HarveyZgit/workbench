import { skillPromptForTab } from '../../core/markdown.js';
import { postToTab } from './messages.js';

const PLUS = { 16: 'icon-plus-16.png', 32: 'icon-plus-32.png' };
const X = { 16: 'icon-x-16.png', 32: 'icon-x-32.png' };

const MENU_ACTION = 'copy-skill-prompt-action';
const MENU_PAGE = 'copy-skill-prompt-page';

/** Per-tab annotate mode. Refresh/navigation clears that tab (content starts off). */
const modeTabs = new Set<number>();

export async function syncActionIcon(tabId?: number): Promise<void> {
  let on = false;
  if (tabId !== undefined) {
    on = modeTabs.has(tabId);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    on = tab?.id !== undefined && modeTabs.has(tab.id);
  }
  await chrome.action.setIcon({ path: on ? X : PLUS });
  await chrome.action.setTitle({ title: on ? '退出标注模式' : '进入标注模式' });
}

export async function setModeForTab(tabId: number, on: boolean): Promise<void> {
  if (on) {
    modeTabs.add(tabId);
  } else {
    modeTabs.delete(tabId);
  }
  postToTab(tabId, { type: 'SET_MODE', on });
  await syncActionIcon(tabId);
}

export async function setMode(on: boolean, tabId?: number): Promise<void> {
  if (tabId !== undefined) {
    await setModeForTab(tabId, on);
    return;
  }
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      if (on) {
        modeTabs.add(tab.id);
      } else {
        modeTabs.delete(tab.id);
      }
      postToTab(tab.id, { type: 'SET_MODE', on });
    }
  }
  await syncActionIcon();
}

export async function copyPromptForTab(tab: { id?: number; url?: string }): Promise<void> {
  if (tab.id === undefined) {
    return;
  }
  const text = skillPromptForTab(tab.id, tab.url || '');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (prompt: string) => {
        void navigator.clipboard.writeText(prompt);
      },
      args: [text],
    });
    postToTab(tab.id, { type: 'COPY_SKILL_PROMPT', tabId: tab.id, url: tab.url || '', copied: true });
  } catch {
    postToTab(tab.id, { type: 'COPY_SKILL_PROMPT', tabId: tab.id, url: tab.url || '' });
  }
}

export function ensureContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ACTION,
      title: '复制 skill prompt',
      contexts: ['action'],
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: '复制 skill prompt',
      contexts: ['page', 'selection', 'editable'],
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
    });
  });
}

export function isCopyPromptMenu(id: string | number): boolean {
  return id === MENU_ACTION || id === MENU_PAGE;
}

export function registerAnnotateUi(): void {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-annotate') {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id === undefined) {
          return;
        }
        void setModeForTab(tab.id, !modeTabs.has(tab.id));
      });
    }
    if (command === 'open-side-panel') {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id !== undefined) {
          postToTab(tab.id, { type: 'OPEN_DRAWER' });
        }
      });
    }
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) {
      return;
    }
    void setModeForTab(tab.id, !modeTabs.has(tab.id));
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!isCopyPromptMenu(info.menuItemId)) {
      return;
    }
    const target = tab ?? undefined;
    if (!target?.id) {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        if (active) {
          void copyPromptForTab(active);
        }
      });
      return;
    }
    void copyPromptForTab(target);
  });

  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'loading' && modeTabs.has(id)) {
      modeTabs.delete(id);
      void syncActionIcon();
    }
  });

  chrome.tabs.onRemoved.addListener((id) => {
    modeTabs.delete(id);
  });

  chrome.tabs.onActivated.addListener((info) => {
    void syncActionIcon(info.tabId);
  });
}
