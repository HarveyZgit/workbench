import type { StoredComment, StoredThread } from '../../core/types.js';

const UI = 'DOM-COMMENT-UI';
const CARD_W = 280;

const ICON_RESOLVE =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/></svg>';
const ICON_DELETE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8"/></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/><path d="M9.5 4l2.5 2.5"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

const CSS = `
  :host {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1c1c1a;
  }
  .card {
    width: ${CARD_W}px;
    box-sizing: border-box;
    background: #f4f5f3;
    border: 1px solid #d8dad4;
    border-radius: 10px;
    box-shadow:
      0 1px 0 rgb(255 255 255 / .7) inset,
      0 16px 36px rgb(28 28 26 / .14);
    padding: 10px;
  }
  .label {
    font-size: 11px;
    color: #5f615c;
    margin-bottom: 6px;
  }
  .field { position: relative; }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 68px;
    max-height: 140px;
    border: 1px solid #d8dad4;
    border-radius: 10px;
    background: #fbfbfa;
    color: #1c1c1a;
    font: 14px/20px inherit;
    padding: 8px 10px 32px;
    resize: none;
    outline: 0;
  }
  textarea::placeholder { color: #8a8c86; }
  textarea:focus { border-color: #1a6b54; }
  .send {
    position: absolute;
    right: 6px;
    bottom: 6px;
    height: 24px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: #1a6b54;
    color: #f4f5f3;
    font: 650 12px inherit;
    cursor: pointer;
  }
  .send:disabled { background: #d8dad4; color: #8a8c86; cursor: default; }
  .send:not(:disabled):hover { background: #155a47; }
  .send:not(:disabled):active { transform: scale(.98); }
  .send:focus-visible, textarea:focus-visible, .icon:focus-visible {
    outline: 2px solid #1a6b54; outline-offset: 2px;
  }
  .err { color: #9b2c2c; font-size: 12px; margin-top: 6px; }
  .head {
    display: flex; align-items: center; justify-content: flex-end; gap: 2px; margin: -2px -2px 4px;
  }
  .icon {
    width: 26px; height: 26px; border: 0; background: transparent; border-radius: 8px;
    color: #5f615c; cursor: pointer; display: grid; place-items: center;
  }
  .icon svg { display: block; }
  .icon:hover { background: #e8e9e5; color: #1c1c1a; }
  .icon.resolve.on { color: #1a6b54; }
  .comments { max-height: 180px; overflow: auto; margin-bottom: 8px; }
  .item { padding: 6px 4px; border-radius: 8px; }
  .item-head { display: flex; align-items: center; gap: 6px; min-height: 26px; }
  .who { flex: 1; font-size: 11px; color: #5f615c; }
  .tools { display: flex; gap: 2px; margin-left: auto; }
  .tools .icon { opacity: 0; }
  .item:hover .tools .icon, .item:focus-within .tools .icon { opacity: .55; }
  .tools .icon:hover { opacity: 1; }
  .item.editing .tools { display: none; }
  @media (hover: none) {
    .tools .icon { opacity: .55; }
  }
  .body { font-size: 13px; line-height: 1.45; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .item.editing .body { display: none; }
  .edit-box { display: none; margin-top: 6px; }
  .item.editing .edit-box { display: block; }
  .edit-box textarea { min-height: 52px; }
  .reply { margin-top: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .send { transform: none; }
  }
`;

function place(host: HTMLElement, anchorRect: DOMRect): void {
  host.style.all = 'unset';
  host.style.display = 'block';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'auto';
  host.style.isolation = 'isolate';
  host.style.left = '0';
  host.style.top = '0';
  document.documentElement.append(host);
  const box = host.getBoundingClientRect();
  const left = Math.min(Math.max(8, anchorRect.left), window.innerWidth - box.width - 8);
  let top = anchorRect.bottom + 8;
  if (top + box.height > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - box.height - 8);
  }
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function autosize(ta: HTMLTextAreaElement, min = 68): void {
  ta.style.height = `${min}px`;
  const next = Math.min(140, Math.max(min, ta.scrollHeight));
  ta.style.height = `${next}px`;
}

function bindField(
  root: ParentNode,
  onSubmit: (body: string) => void,
  emptyMsg: string,
  minHeight = 68,
): HTMLTextAreaElement {
  const ta = root.querySelector('textarea')!;
  const send = root.querySelector('.send') as HTMLButtonElement;
  const err = root.querySelector('.err');
  const sync = (): void => {
    autosize(ta, minHeight);
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
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey || !ev.shiftKey)) {
      ev.preventDefault();
      go();
    }
  });
  send.addEventListener('click', go);
  sync();
  return ta;
}

function fieldHtml(placeholder: string): string {
  return `<div class="field">
      <textarea rows="2" placeholder="${placeholder}"></textarea>
      <button class="send" type="button" disabled>保存</button>
    </div>
    <div class="err"></div>`;
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
  shadow.innerHTML = `<style>${CSS}</style>
    <div class="card">
      <div class="label">评论</div>
      ${fieldHtml('请输入评论内容')}
    </div>`;
  const err = shadow.querySelector('.err');
  if (err && error) {
    err.textContent = error;
  }
  place(host, anchorRect);
  bindField(shadow, onSubmit, '请输入评论内容').focus();
}

export function openThreadPanel(
  thread: StoredThread,
  anchorRect: DOMRect,
  handlers: {
    onSave: (body: string, editId?: string) => void;
    onDeleteComment: (commentId: string) => void;
    onResolve: () => void;
    onCancel: () => void;
  },
): void {
  closeComposer();
  const list = thread.comments
    .map((c: StoredComment) => `<div class="item" data-comment="${c.id}">
        <div class="item-head">
          <span class="who">${escapeHtml(whoLabel(c.author))}</span>
          <span class="tools">
            <button class="icon edit" type="button" aria-label="编辑这条评论">${ICON_EDIT}</button>
            <button class="icon del" type="button" aria-label="删除这条评论">${ICON_DELETE}</button>
          </span>
        </div>
        <div class="body">${escapeHtml(c.body)}</div>
        <div class="edit-box">${fieldHtml('请输入评论内容')}</div>
      </div>`)
    .join('');
  const resolved = thread.status === 'resolved';
  const host = document.createElement(UI.toLowerCase());
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="card">
      <div class="head">
        <button class="icon resolve${resolved ? ' on' : ''}" type="button" aria-label="${resolved ? '已解决' : '标记已解决'}">${ICON_RESOLVE}</button>
        <button class="icon close" type="button" aria-label="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="comments">${list}</div>
      <div class="reply">
        <div class="label">评论</div>
        ${fieldHtml('请输入评论内容')}
      </div>
    </div>`;
  place(host, anchorRect);
  const replyRoot = shadow.querySelector('.reply')!;
  bindField(replyRoot, (body) => handlers.onSave(body), '请输入评论内容').focus();
  shadow.querySelector('.close')?.addEventListener('click', handlers.onCancel);
  shadow.querySelector('.resolve')?.addEventListener('click', handlers.onResolve);
  shadow.querySelectorAll<HTMLElement>('.item').forEach((item) => {
    const commentId = item.dataset.comment;
    if (!commentId) {
      return;
    }
    const found = thread.comments.find((c) => c.id === commentId);
    const editBox = item.querySelector('.edit-box');
    if (!found || !editBox) {
      return;
    }
    item.querySelector('.edit')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      shadow.querySelectorAll('.item.editing').forEach((other) => other.classList.remove('editing'));
      item.classList.add('editing');
      const ta = editBox.querySelector('textarea');
      if (ta) {
        ta.value = found.body;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
    });
    item.querySelector('.del')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onDeleteComment(commentId);
    });
    bindField(editBox, (body) => handlers.onSave(body, commentId), '请输入评论内容', 52);
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
  const err = host?.shadowRoot?.querySelector('.reply .err') || host?.shadowRoot?.querySelector('.err');
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
