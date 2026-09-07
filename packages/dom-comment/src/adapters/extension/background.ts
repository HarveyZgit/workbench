import {
  ensureContextMenus,
  registerAnnotateUi,
  setMode,
  setModeForTab,
  syncActionIcon,
} from './annotate-mode.js';
import { HOST_NAME, postToBackground, postToTab, type ExtMessage } from './messages.js';
import { cropVisiblePng, dataUrlPngBase64 } from './screenshot.js';

interface NativePort {
  postMessage: (msg: unknown) => void;
  onMessage: { addListener: (fn: (msg: never) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
}

let port: NativePort | null = null;
let reqSeq = 1;
const waiters = new Map<
  string,
  (msg: {
    ok: boolean;
    error?: string;
    tab?: unknown;
    thread?: unknown;
    sessionId?: string;
    batchId?: string;
    pngBase64?: string;
  }) => void
>();

function nextId(): string {
  reqSeq += 1;
  return `ext-${reqSeq}`;
}

function connect(): NativePort {
  if (port) {
    return port;
  }
  port = chrome.runtime.connectNative(HOST_NAME) as NativePort;
  port.onMessage.addListener(
    (msg: { id?: string; op?: string; ok?: boolean; error?: string; tabId?: number }) => {
      if (msg.op === 'focusTab' && typeof msg.tabId === 'number') {
        void focusTab(msg.tabId).then((ok) => {
          port?.postMessage({
            id: msg.id,
            ok,
            error: ok ? undefined : '无法聚焦该标签。请先查看该评论的截图。',
          });
        });
        return;
      }
      const { id } = msg;
      if (id && waiters.has(id)) {
        waiters.get(id)!({
          ok: Boolean(msg.ok),
          error: msg.error,
          tab: (msg as { tab?: unknown }).tab,
          thread: (msg as { thread?: unknown }).thread,
          sessionId: (msg as { sessionId?: string }).sessionId,
          batchId: (msg as { batchId?: string }).batchId,
          pngBase64: (msg as { pngBase64?: string }).pngBase64,
        });
        waiters.delete(id);
      }
    },
  );
  port.onDisconnect.addListener(() => {
    port = null;
    for (const [id, resolve] of waiters) {
      waiters.delete(id);
      resolve({
        ok: false,
        error: '本机写入未就绪。在 packages/dom-comment 运行 rushx setup，再刷新这个扩展。',
      });
    }
  });
  return port;
}

function hostCall(payload: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  tab?: unknown;
  thread?: unknown;
  sessionId?: string;
  batchId?: string;
  pngBase64?: string;
}> {
  const id = String(payload.id || nextId());
  payload.id = id;
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    try {
      connect().postMessage(payload);
    } catch {
      waiters.delete(id);
      resolve({
        ok: false,
        error: '本机写入未就绪。在 packages/dom-comment 运行 rushx setup，再刷新这个扩展。',
      });
    }
    setTimeout(() => {
      if (waiters.has(id)) {
        waiters.delete(id);
        resolve({
          ok: false,
          error: '本机写入未就绪。在 packages/dom-comment 运行 rushx setup，再刷新这个扩展。',
        });
      }
    }, 8000);
  });
}

let sessionGate: Promise<void> | undefined;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0);
}

async function liveTabIds(): Promise<number[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number' && id > 0);
}

async function mintBrowserSession(tabIds: number[]): Promise<void> {
  const sessionId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
  await chrome.storage.session.set({ sessionId });
  await chrome.storage.local.set({ sessionId, tabIds });
  await hostCall({ id: nextId(), op: 'beginSession', sessionId });
}

async function initSession(): Promise<void> {
  const mem = await chrome.storage.session.get('sessionId');
  if (asString(mem.sessionId)) {
    return;
  }
  const local = await chrome.storage.local.get(['sessionId', 'tabIds']);
  const tabIds = await liveTabIds();
  const prevIds = asIdList(local.tabIds);
  const overlap = tabIds.some((id) => prevIds.includes(id));
  const hello = await hostCall({ id: nextId(), op: 'hello' });
  const diskId = asString(hello.sessionId);
  const reuse = Boolean(diskId) && (overlap || prevIds.length === 0);
  if (reuse) {
    await chrome.storage.session.set({ sessionId: diskId });
    await chrome.storage.local.set({ sessionId: diskId, tabIds });
    await hostCall({ id: nextId(), op: 'reclaimTabs', tabIds, sessionId: diskId });
    return;
  }
  await mintBrowserSession(tabIds);
}

function ensureSession(): Promise<void> {
  sessionGate ??= initSession();
  return sessionGate;
}

async function focusTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch {
    return false;
  }
}

async function captureTabPng(windowId?: number): Promise<string> {
  const dataUrl =
    windowId === undefined
      ? await chrome.tabs.captureVisibleTab({ format: 'png' })
      : await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  if (!dataUrl) {
    throw new Error('empty capture');
  }
  return dataUrl;
}

function askTab(tabId: number, msg: ExtMessage, timeoutMs = 400): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    setTimeout(finish, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        void chrome.runtime.lastError;
        finish();
      });
    } catch {
      finish();
    }
  });
}

async function handleCreate(
  msg: Extract<ExtMessage, { type: 'CREATE_THREAD' }>,
  tabId: number,
  windowId?: number,
): Promise<void> {
  await ensureSession();
  await askTab(tabId, { type: 'PREPARE_CAPTURE' });
  let png = '';
  try {
    const dataUrl = await captureTabPng(windowId);
    try {
      png = await cropVisiblePng(dataUrl, msg.cropRect, msg.dpr);
    } catch (err) {
      console.error('dom-comment crop failed, using full tab', err);
      png = dataUrlPngBase64(dataUrl);
    }
  } catch (err) {
    console.error('dom-comment captureVisibleTab failed', err);
  }
  await ensureSession();
  const res = await hostCall({
    id: nextId(),
    op: 'createThread',
    tabId,
    url: msg.url,
    title: msg.title,
    captured: msg.captured,
    body: msg.body,
    screenshotPngBase64: png,
  });
  const result: ExtMessage = res.ok
    ? { type: 'CREATE_THREAD_RESULT', ok: true, thread: res.thread as never }
    : { type: 'CREATE_THREAD_RESULT', ok: false, error: res.error || '保存失败' };
  postToTab(tabId, result);
  if (res.ok) {
    postToBackground({ type: 'THREADS_CHANGED', tabId, url: msg.url });
    postToTab(tabId, { type: 'THREADS_CHANGED', tabId, url: msg.url });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSession();
  void syncActionIcon();
  ensureContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  sessionGate = liveTabIds().then((ids) => mintBrowserSession(ids));
  void sessionGate;
  ensureContextMenus();
});

chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg.type === 'SET_MODE_REQUEST') {
    const id = tabId ?? msg.tabId;
    if (id !== undefined) {
      void setModeForTab(id, msg.on);
    } else {
      void setMode(msg.on);
    }
  }
  if (msg.type === 'FOCUS_THREAD') {
    const id = msg.tabId ?? tabId;
    if (id !== undefined) {
      void setModeForTab(id, true).then(() => {
        postToTab(id, { type: 'SET_FOCUS_THREAD', threadId: msg.threadId });
      });
    }
  }
  if (msg.type === 'OPEN_DRAWER') {
    const id = tabId ?? msg.tabId;
    if (id !== undefined) {
      postToTab(id, { type: 'OPEN_DRAWER' });
    }
  }
  if (msg.type === 'CREATE_THREAD' && tabId !== undefined) {
    void handleCreate(msg, tabId, sender.tab?.windowId);
  }
  if (msg.type === 'PUBLISH_TAB') {
    const id = tabId ?? undefined;
    if (id !== undefined) {
      void ensureSession()
        .then(() => hostCall({ id: nextId(), op: 'publishTab', tabId: id }))
        .then((res) => {
          const out: ExtMessage = res.ok
            ? { type: 'PUBLISH_RESULT', ok: true, batchId: res.batchId }
            : { type: 'PUBLISH_RESULT', ok: false, error: res.error || '发布失败' };
          postToTab(id, out);
          if (res.ok) {
            postToTab(id, { type: 'THREADS_CHANGED', tabId: id });
          }
        });
    }
  }
  if (msg.type === 'DELETE_THREAD') {
    const id = tabId ?? msg.tabId;
    void hostCall({ id: nextId(), op: 'deleteThread', threadId: msg.threadId }).then(() => {
      if (id !== undefined) {
        postToTab(id, { type: 'THREADS_CHANGED', tabId: id });
      }
      sendResponse({ type: 'THREADS_CHANGED', tabId: id || 0 });
    });
    return true;
  }
  if (msg.type === 'DISCARD_PENDING' && tabId !== undefined) {
    void hostCall({ id: nextId(), op: 'discardPending', tabId }).then(() => {
      postToTab(tabId, { type: 'THREADS_CHANGED', tabId });
    });
  }
  if (msg.type === 'LOAD_SCREENSHOT') {
    const id = msg.tabId > 0 ? msg.tabId : tabId;
    if (id === undefined) {
      return undefined;
    }
    void ensureSession()
      .then(() => hostCall({ id: nextId(), op: 'loadScreenshot', tabId: id, rel: msg.rel }))
      .then((res) => {
        const out: ExtMessage = {
          type: 'LOAD_SCREENSHOT_RESULT',
          ok: Boolean(res.ok && res.pngBase64),
          threadId: msg.threadId,
          dataUrl: res.pngBase64 ? `data:image/png;base64,${res.pngBase64}` : undefined,
        };
        if (tabId !== undefined) {
          postToTab(tabId, out);
        }
        sendResponse(out);
      });
    return true;
  }
  if (msg.type === 'LOAD_TAB') {
    const id = msg.tabId > 0 ? msg.tabId : tabId;
    if (id === undefined) {
      sendResponse({ type: 'LOAD_TAB_RESULT', ok: false, error: 'no tab' });
      return true;
    }
    void ensureSession()
      .then(() => hostCall({ id: nextId(), op: 'loadTab', tabId: id }))
      .then((res) => {
        const out: ExtMessage = res.ok
          ? { type: 'LOAD_TAB_RESULT', ok: true, tab: res.tab as never }
          : { type: 'LOAD_TAB_RESULT', ok: false, error: res.error };
        if (tabId !== undefined) {
          postToTab(tabId, out);
        }
        sendResponse(out);
      });
    return true;
  }
  if (msg.type === 'RESOLVE_THREAD') {
    void hostCall({ id: nextId(), op: 'resolve', threadId: msg.threadId }).then(() => {
      postToBackground({ type: 'THREADS_CHANGED', tabId: tabId || 0 });
      if (tabId !== undefined) {
        postToTab(tabId, { type: 'THREADS_CHANGED', tabId });
      }
    });
  }
  if (msg.type === 'REPLY_THREAD') {
    void hostCall({
      id: nextId(),
      op: 'reply',
      threadId: msg.threadId,
      body: msg.body,
      author: 'user',
    }).then(() => {
      if (tabId !== undefined) {
        postToTab(tabId, { type: 'THREADS_CHANGED', tabId });
      }
    });
  }
  if (msg.type === 'EDIT_COMMENT') {
    void hostCall({
      id: nextId(),
      op: 'editComment',
      threadId: msg.threadId,
      commentId: msg.commentId,
      body: msg.body,
    }).then(() => {
      if (tabId !== undefined) {
        postToTab(tabId, { type: 'THREADS_CHANGED', tabId });
      }
    });
  }
  if (msg.type === 'DELETE_COMMENT') {
    void hostCall({
      id: nextId(),
      op: 'deleteComment',
      threadId: msg.threadId,
      commentId: msg.commentId,
    }).then(() => {
      if (tabId !== undefined) {
        postToTab(tabId, { type: 'THREADS_CHANGED', tabId });
      }
    });
  }
  return undefined;
});

registerAnnotateUi();
ensureContextMenus();
void connect();
void ensureSession();
void syncActionIcon();
