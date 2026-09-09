// System-browser transport: queue comment mutations, flush on interval / Save / tab close.
import type { HostToWebview, WebviewToHost } from './messages';
import { isCommentMutation } from './protocol';
import { createSyncQueue, startInterval } from './sync-queue';

export interface BrowserHostConfig {
  file: string;
  syncIntervalMs: number;
  apiBase: string;
}

export interface PreviewHostApi {
  postMessage: (msg: WebviewToHost) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

function dispatchHost(msg: HostToWebview): void {
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
}

function stateKey(file: string): string {
  return `mdc-preview-state:${file}`;
}

async function postJson<T>(url: string, body: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
  if (!res.ok) {
    throw new Error(`preview request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function createBrowserHost(config: BrowserHostConfig): PreviewHostApi {
  const queue = createSyncQueue<WebviewToHost>();
  const saveBtn = document.getElementById('mdc-save-sync') as HTMLButtonElement | null;
  const statusEl = document.getElementById('mdc-sync-status');
  let flushing = false;
  let lastError = '';

  const setStatus = (text: string) => {
    if (statusEl) {
      statusEl.textContent = text;
    }
    if (saveBtn) {
      saveBtn.disabled = queue.size() === 0 && !flushing;
    }
  };

  const applyIncoming = (messages: HostToWebview[]) => {
    for (const msg of messages) {
      dispatchHost(msg);
    }
  };

  const flush = async (keepalive = false): Promise<void> => {
    if (flushing) {
      return;
    }
    const batch = queue.take();
    flushing = true;
    setStatus(batch.length ? '正在保存…' : '同步中…');
    try {
      if (batch.length > 0) {
        const result = await postJson<{ ok: boolean; messages: HostToWebview[] }>(
          `${config.apiBase}/api/flush`,
          { file: config.file, messages: batch },
          keepalive,
        );
        applyIncoming(result.messages ?? []);
      } else {
        const snap = await fetch(`${config.apiBase}/api/threads?file=${encodeURIComponent(config.file)}`);
        if (snap.ok) {
          const data = (await snap.json()) as { messages?: HostToWebview[] };
          applyIncoming(data.messages ?? []);
        }
      }
      lastError = '';
      setStatus(queue.size() ? `未保存 ${queue.size()}` : '已同步');
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      for (const item of batch) {
        queue.enqueue(item);
      }
      setStatus('同步失败');
    } finally {
      flushing = false;
      if (saveBtn) {
        saveBtn.disabled = queue.size() === 0;
      }
      if (lastError && queue.size() === 0) {
        setStatus('同步失败');
      }
    }
  };

  const flushBeacon = (): void => {
    const batch = queue.take();
    if (batch.length === 0) {
      return;
    }
    const payload = JSON.stringify({ file: config.file, messages: batch });
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(`${config.apiBase}/api/flush`, blob)) {
        return;
      }
    } catch {
      // fall through to keepalive fetch
    }
    void fetch(`${config.apiBase}/api/flush`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  };

  const postImmediate = async (msg: WebviewToHost): Promise<void> => {
    const result = await postJson<{ ok: boolean; messages: HostToWebview[] }>(
      `${config.apiBase}/api/message`,
      { file: config.file, message: msg },
    );
    applyIncoming(result.messages ?? []);
  };

  document.body.classList.add('mdc-browser');
  saveBtn?.addEventListener('click', () => {
    void flush();
  });
  window.addEventListener('pagehide', () => flushBeacon());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushBeacon();
    }
  });
  startInterval(() => {
    void flush();
  }, config.syncIntervalMs);
  setStatus('已同步');
  if (saveBtn) {
    saveBtn.disabled = true;
  }

  return {
    postMessage(msg) {
      if (msg.type === 'copySkillPrompt') {
        const quoted = /\s/.test(config.file) ? `"${config.file}"` : config.file;
        void navigator.clipboard.writeText(`/markdown-comment ${quoted}`).then(
          () => dispatchHost({ type: 'skillPromptCopied' }),
          () => setStatus('无法复制'),
        );
        return;
      }
      if (msg.type === 'ready' || !isCommentMutation(msg.type)) {
        void postImmediate(msg).catch((err) => {
          lastError = err instanceof Error ? err.message : String(err);
          setStatus('同步失败');
        });
        return;
      }
      queue.enqueue(msg);
      setStatus(`未保存 ${queue.size()}`);
    },
    getState() {
      try {
        const raw = sessionStorage.getItem(stateKey(config.file));
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    },
    setState(state) {
      try {
        sessionStorage.setItem(stateKey(config.file), JSON.stringify(state));
      } catch {
        // quota / private mode
      }
    },
  };
}

export function readBrowserConfig(): BrowserHostConfig | null {
  const raw = window.mdcBrowser;
  if (!raw || typeof raw.file !== 'string' || !raw.file) {
    return null;
  }
  return {
    file: raw.file,
    syncIntervalMs: Math.max(1000, Number(raw.syncIntervalMs) || 5000),
    apiBase: typeof raw.apiBase === 'string' ? raw.apiBase : '',
  };
}
