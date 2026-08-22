import type { CapturedTarget, StoredTabFile, StoredThread } from '../../core/types.js';

export const HOST_NAME = 'com.workbench.dom_comment';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExtMessage =
  | { type: 'SET_MODE'; on: boolean }
  | { type: 'SET_MODE_REQUEST'; on: boolean }
  | {
      type: 'CREATE_THREAD';
      tabId: number;
      url: string;
      title: string;
      captured: CapturedTarget;
      cropRect: CropRect;
      dpr: number;
      body: string;
    }
  | { type: 'CREATE_THREAD_RESULT'; ok: boolean; thread?: StoredThread; error?: string }
  | { type: 'LOAD_TAB'; tabId: number }
  | { type: 'LOAD_TAB_RESULT'; ok: boolean; tab?: StoredTabFile; error?: string }
  | { type: 'SET_FOCUS_THREAD'; threadId: string }
  | { type: 'THREADS_CHANGED'; tabId: number; url?: string }
  | { type: 'HOST_ERROR'; message: string }
  | { type: 'RESOLVE_THREAD'; threadId: string }
  | { type: 'REPLY_THREAD'; threadId: string; body: string }
  | { type: 'EDIT_COMMENT'; threadId: string; commentId: string; body: string }
  | { type: 'PREPARE_CAPTURE' };

function settle(result: unknown): void {
  if (result !== undefined && result !== null && typeof (result as Promise<unknown>).then === 'function') {
    void (result as Promise<unknown>).then(
      () => undefined,
      () => undefined,
    );
  }
}

export function postToBackground(msg: ExtMessage, onResult?: (res: ExtMessage | undefined) => void): void {
  try {
    const result = chrome.runtime.sendMessage(msg, (res: never) => {
      if (chrome.runtime.lastError) {
        onResult?.(undefined);
        return;
      }
      onResult?.(res as ExtMessage);
    });
    settle(result);
  } catch {
    onResult?.(undefined);
  }
}

export function postToTab(tabId: number, msg: ExtMessage): void {
  try {
    const result = chrome.tabs.sendMessage(tabId, msg, () => {
      void chrome.runtime.lastError;
    });
    settle(result);
  } catch {
    // chrome:// tabs and freshly reloaded extensions have no receiving end
  }
}
