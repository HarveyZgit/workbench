import type { StoredComment, StoredThread } from '../../core/types.js';

const UI = 'DOM-COMMENT-UI';
const PILL_W = 360;

const CSS = `
  :host { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0a0a0a; }
  .bar {
    display: flex; align-items: center; gap: 4px;
    width: ${PILL_W}px; min-height: 44px; box-sizing: border-box;
    padding: 6px 6px 6px 16px;
    background: #fff;
    border-radius: 999px;
    box-shadow: 0 8px 28px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.08);
  }
  .bar.multi { border-radius: 18px; align-items: flex-end; }
  textarea {
    flex: 1; border: 0; outline: 0; resize: none; background: transparent;
    font: 14px/20px ui-sans-serif, system-ui, sans-serif; color: #0a0a0a;
    padding: 8px 4px; max-height: 120px;
  }
  textarea::placeholder { color: #9ca3af; }
  .send {
    flex: none; width: 32px; height: 32px; border: 0; border-radius: 999px;
    background: transparent; color: #2563EB; cursor: pointer; display: grid; place-items: center;
  }
  .send:disabled { color: #d1d5db; cursor: default; }
  .send svg { display: block; }
  .err { color: #b91c1c; font-size: 12px; padding: 6px 8px 0; min-height: 0; }
  .sheet {
    width: ${PILL_W}px; background: #fff; border-radius: 18px; overflow: hidden;
    box-shadow: 0 12px 40px rgba(15,23,42,.16), 0 0 0 1px rgba(15,23,42,.06);
  }
  .head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 8px 8px 0; }
  .link {
    background: none; border: 0; color: #737373; font: 12px/1.4 inherit; cursor: pointer; padding: 4px 6px; border-radius: 6px;
  }
  .link:hover { background: #f4f4f5; color: #0a0a0a; }
  .x {
    width: 28px; height: 28px; border: 0; background: transparent; border-radius: 8px;
    color: #737373; cursor: pointer; display: grid; place-items: center;
  }
  .x:hover { background: #f4f4f5; color: #0a0a0a; }
  .comments { padding: 4px 14px 8px; max-height: 220px; overflow: auto; }
  .item { padding: 8px 6px; border-radius: 8px; }
  .item.editable { cursor: pointer; }
  .item.editable:hover { background: #fafafa; }
  .who { font-size: 11px; color: #737373; font-weight: 500; }
  .body { font-size: 13px; line-height: 1.45; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .sheet .bar {
    width: auto; margin: 8px; box-shadow: none;
    border: 1px solid #e5e7eb;
  }
  .sheet .err { padding: 0 16px 8px; }
`;

const SEND_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function place(host: HTMLElement, anchorRect: DOMRect): void {
  host.style.all = 'unset';
  host.style.display = 'block';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.left = '0';
  host.style.top = '0';
  document.documentElement.append(host);
  const box = host.getBoundingClientRect();
  let left = anchorRect.left + Math.min(Math.max(anchorRect.width * 0.4, 28), 160);
  let top = anchorRect.top + anchorRect.height / 2 - Math.min(box.height, 44) / 2;
  left = Math.min(Math.max(8, left), window.innerWidth - box.width - 8);
  top = Math.min(Math.max(8, top), window.innerHeight - box.height - 8);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function autosize(ta: HTMLTextAreaElement, bar: HTMLElement): void {
  ta.style.height = '20px';
  const next = Math.min(120, Math.max(20, ta.scrollHeight));
  ta.style.height = `${next}px`;
  bar.classList.toggle('multi', next > 28);
}

function bindBar(
  shadow: ShadowRoot,
  onSubmit: (body: string) => void,
  emptyMsg: string,
): HTMLTextAreaElement {
  const ta = shadow.querySelector('textarea')!;
  const send = shadow.querySelector('.send') as HTMLButtonElement;
  const err = shadow.querySelector('.err');
  const bar = shadow.querySelector('.bar') as HTMLElement;
  const sync = (): void => {
    autosize(ta, bar);
    send.disabled = !ta.value.trim();
  };
  const go = (): void => {
    const body = ta.value.trim();
    if (!body) {
      if (err) {
        err.textContent = emptyMsg;
      }
      return;
    }
    if (err) {
      err.textContent = '';
    }
    onSubmit(body);
  };
  ta.addEventListener('input', sync);
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      go();
    }
  });
  send.addEventListener('click', go);
  sync();
  ta.focus();
  return ta;
}

function barHtml(placeholder: string): string {
  return `<div class="bar"><textarea rows="1" placeholder="${placeholder}"></textarea><button class="send" type="button" disabled>${SEND_SVG}</button></div><div class="err"></div>`;
}

function whoLabel(author: string): string {
  if (author === 'user') {
    return '我';
  }
  if (author === 'agent') {
    return 'Agent';
  }
  return author;
}

export function openComposer(
  anchorRect: DOMRect,
  onSubmit: (body: string) => void,
  _onCancel: () => void,
  error = '',
): void {
  closeComposer();
  const host = document.createElement(UI.toLowerCase());
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style>${barHtml('添加评论…')}`;
  const err = shadow.querySelector('.err');
  if (err && error) {
    err.textContent = error;
  }
  place(host, anchorRect);
  bindBar(shadow, onSubmit, '请输入评论');
}

export function openThreadPanel(
  thread: StoredThread,
  anchorRect: DOMRect,
  handlers: {
    onSave: (body: string, editId?: string) => void;
    onResolve: () => void;
    onCancel: () => void;
  },
): void {
  closeComposer();
  let editingId: string | undefined;
  const list = thread.comments
    .map((c: StoredComment) => {
      const editable = c.author === 'user' ? ' editable' : '';
      return `<div class="item${editable}" data-comment="${c.id}"><div class="who">${escapeHtml(whoLabel(c.author))}</div><div class="body">${escapeHtml(c.body)}</div></div>`;
    })
    .join('');
  const resolve =
    thread.status === 'open'
      ? '<button class="link resolve" type="button">标为已解决</button>'
      : '<span class="link" style="cursor:default">已解决</span>';
  const host = document.createElement(UI.toLowerCase());
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="sheet">
      <div class="head">${resolve}<button class="x" type="button" aria-label="关闭">${X_SVG}</button></div>
      <div class="comments">${list}</div>
      ${barHtml('添加回复…')}
    </div>`;
  place(host, anchorRect);
  const ta = bindBar(
    shadow,
    (body) => {
      handlers.onSave(body, editingId);
    },
    '请输入内容',
  );
  shadow.querySelector('.x')?.addEventListener('click', handlers.onCancel);
  shadow.querySelector('.resolve')?.addEventListener('click', handlers.onResolve);
  shadow.querySelectorAll<HTMLElement>('.item.editable').forEach((item) => {
    item.addEventListener('click', () => {
      const found = thread.comments.find((c) => c.id === item.dataset.comment);
      if (!found) {
        return;
      }
      editingId = found.id;
      ta.value = found.body;
      ta.placeholder = '编辑评论…';
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function closeComposer(): void {
  document.querySelector(UI.toLowerCase())?.remove();
}

export function composerOpen(): boolean {
  return Boolean(document.querySelector(UI.toLowerCase()));
}

export function setComposerError(message: string): void {
  const host = document.querySelector(UI.toLowerCase());
  const err = host?.shadowRoot?.querySelector('.err');
  if (err) {
    err.textContent = message;
  }
}

export function setComposerHidden(hidden: boolean): void {
  const host = document.querySelector(UI.toLowerCase()) as HTMLElement | null;
  if (host) {
    host.style.visibility = hidden ? 'hidden' : 'visible';
  }
}
