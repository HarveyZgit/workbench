import { kindLabel, quoteOf } from '../../core/markdown.js';
import { threadsInScope } from '../../core/threads-view.js';
import { clip } from '../../core/anchor.js';
import { LIST_QUOTE_CLIP, type StoredTabFile, type StoredThread } from '../../core/types.js';

const HOST = 'DOM-COMMENT-QUEUE';
const BLUE = '#1A6B54';

const ICON_RESOLVE =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

const CSS = `
  :host {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1c1c1a;
    all: initial;
  }
  * { box-sizing: border-box; }
  .ball {
    position: fixed;
    right: 20px;
    bottom: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 0;
    background: ${BLUE};
    color: #fff;
    font: 700 15px/1 system-ui, sans-serif;
    box-shadow: 0 8px 24px rgb(26 107 84 / .35);
    cursor: pointer;
    z-index: 2147483645;
    pointer-events: auto;
    display: grid;
    place-items: center;
  }
  .ball:hover { background: #155a47; }
  .ball:focus-visible { outline: 2px solid #1a6b54; outline-offset: 3px; }
  .ball .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: #9b2c2c;
    color: #fff;
    font: 700 10px/18px system-ui, sans-serif;
    text-align: center;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(28 28 26 / .28);
    z-index: 2147483645;
    pointer-events: auto;
    opacity: 0;
    transition: opacity .18s ease;
  }
  .scrim.open { opacity: 1; }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    width: min(360px, 92vw);
    height: 100vh;
    background: #f4f5f3;
    border-left: 1px solid #d8dad4;
    box-shadow: -12px 0 36px rgb(28 28 26 / .16);
    z-index: 2147483646;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    transform: translateX(104%);
    transition: transform .2s ease;
  }
  .panel.open { transform: translateX(0); }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 14px 10px;
    border-bottom: 1px solid #e4e5e1;
  }
  .title { flex: 1; font: 700 14px/1.3 inherit; color: #1c1c1a; }
  .icon {
    width: 28px; height: 28px; border: 0; background: transparent; border-radius: 8px;
    color: #5f615c; cursor: pointer; display: grid; place-items: center;
  }
  .icon:hover { background: #e8e9e5; color: #1c1c1a; }
  .icon:focus-visible, .ball:focus-visible, .card:focus-visible, .resolve:focus-visible, .scope:focus-visible {
    outline: 2px solid #1a6b54; outline-offset: 2px;
  }
  .toolbar {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #e4e5e1;
  }
  .scope {
    font: 12px inherit; color: #5f615c; display: flex; align-items: center; gap: 6px; cursor: pointer;
  }
  .hint { padding: 8px 14px 0; font-size: 12px; color: #9b2c2c; min-height: 20px; }
  .list { flex: 1; overflow: auto; padding: 10px 12px 20px; display: flex; flex-direction: column; gap: 8px; }
  .empty { color: #5f615c; font-size: 13px; padding: 24px 8px; text-align: center; }
  .card {
    background: #fbfbfa;
    border: 1px solid #d8dad4;
    border-radius: 10px;
    padding: 10px;
    cursor: pointer;
    text-align: left;
  }
  .card:hover { border-color: #1a6b54; }
  .card.selected { border-color: #1a6b54; box-shadow: inset 0 0 0 1px #1a6b54; background: #eef6f3; }
  .card.resolved { opacity: .72; }
  .list.select-off .card { cursor: default; }
  .list.select-off .card:hover { border-color: #d8dad4; }
  .list.select-off .card.selected { border-color: #1a6b54; }
  .card-head { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px; }
  .num {
    flex-shrink: 0; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px;
    background: #1a6b54; color: #fff; font: 700 11px/20px system-ui, sans-serif; text-align: center;
  }
  .quote { flex: 1; font: 650 12px/1.35 inherit; color: #1c1c1a; word-break: break-word; }
  .meta { font-size: 11px; color: #5f615c; margin-bottom: 6px; }
  .comments { display: flex; flex-direction: column; gap: 4px; }
  .c { font-size: 12px; line-height: 1.4; color: #1c1c1a; white-space: pre-wrap; word-break: break-word; }
  .who { color: #5f615c; font-size: 11px; }
  .resolve {
    width: 26px; height: 26px; border: 0; background: transparent; border-radius: 8px;
    color: #5f615c; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
  }
  .resolve:hover { background: #e8e9e5; color: #1a6b54; }
  .resolve.on { color: #1a6b54; }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 88px;
    transform: translateX(-50%);
    background: #1c1c1a;
    color: #f4f5f3;
    font: 650 12px/1.3 system-ui, sans-serif;
    padding: 8px 14px;
    border-radius: 999px;
    z-index: 2147483647;
    pointer-events: none;
    opacity: 0;
    transition: opacity .15s ease;
  }
  .toast.show { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .scrim, .panel, .toast { transition: none; }
  }
`;

export interface DrawerHandlers {
  onResolve: (threadId: string) => void;
  onSelect: (thread: StoredThread) => void;
  /** Fired when the drawer opens (float ball / command). */
  onOpen?: () => void;
  /** Fired when the drawer closes (scrim / X / Esc / float toggle). */
  onClose?: () => void;
}

let open = false;
let allPages = false;
let tabCache: StoredTabFile | undefined;
let pageUrl = '';
let handlers: DrawerHandlers | undefined;
let statusMsg = '';
let toastTimer = 0;
let selectEnabled = true;
let selectedId: string | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureHost(): HTMLElement {
  let host = document.querySelector(HOST.toLowerCase()) as HTMLElement | null;
  if (!host) {
    host = document.createElement(HOST.toLowerCase());
    host.style.all = 'unset';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483645';
    host.style.pointerEvents = 'none';
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', onRootClick);
  }
  return host;
}

function openCount(): number {
  if (!tabCache) {
    return 0;
  }
  return threadsInScope(tabCache, pageUrl, false).filter((item) => item.thread.status === 'open').length;
}

function cardHtml(thread: StoredThread): string {
  const resolved = thread.status === 'resolved';
  const selected = selectedId === thread.id;
  const kind = kindLabel(thread.anchor);
  const quote = clip(quoteOf(thread.anchor), LIST_QUOTE_CLIP);
  const num = Number.isInteger(thread.number) && thread.number > 0 ? thread.number : 0;
  const numBadge = num > 0 ? `<span class="num" title="序号">${num}</span>` : '';
  const comments = thread.comments
    .map(
      (c) =>
        `<div class="c"><span class="who">${escapeHtml(c.author === 'user' ? '我' : c.author === 'agent' ? 'Agent' : c.author)}</span> ${escapeHtml(c.body)}</div>`,
    )
    .join('');
  const resolve =
    thread.status === 'open'
      ? `<button class="resolve" type="button" data-act="resolve" data-id="${escapeHtml(thread.id)}" title="标记已解决">${ICON_RESOLVE}</button>`
      : `<button class="resolve on" type="button" data-act="resolve" data-id="${escapeHtml(thread.id)}" title="已解决" disabled>${ICON_RESOLVE}</button>`;
  const classes = ['card', resolved ? 'resolved' : '', selected ? 'selected' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" data-act="select" data-id="${escapeHtml(thread.id)}" role="button" tabindex="0">
    <div class="card-head">
      ${numBadge}
      <div class="quote">[${escapeHtml(kind)}] ${escapeHtml(quote)}</div>
      ${resolve}
    </div>
    <div class="meta">#${escapeHtml(thread.id.slice(0, 8))}${resolved ? ' · 已解决' : ''}</div>
    <div class="comments">${comments || '<div class="who">暂无评论</div>'}</div>
  </div>`;
}

function paint(): void {
  const host = ensureHost();
  const root = host.shadowRoot!;
  const n = openCount();
  const badge = n > 0 ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '';
  const items = tabCache ? threadsInScope(tabCache, pageUrl, allPages) : [];
  const list =
    items.length === 0
      ? `<div class="empty">${allPages ? '这个标签页还没有评论' : '当前页还没有评论'}</div>`
      : items.map((item) => cardHtml(item.thread)).join('');
  const selectClass = selectEnabled ? '' : ' select-off';
  root.innerHTML = `<style>${CSS}</style>
    <button class="ball" type="button" data-act="toggle" title="评论列表" aria-label="打开评论列表">评${badge}</button>
    <div class="scrim ${open ? 'open' : ''}" data-act="close" style="${open ? '' : 'display:none'}"></div>
    <aside class="panel ${open ? 'open' : ''}" style="${open ? '' : 'display:none'}" aria-label="评论列表">
      <div class="head">
        <div class="title">页面评论</div>
        <button class="icon" type="button" data-act="close" title="关闭" aria-label="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="toolbar">
        <label class="scope"><input type="checkbox" data-act="scope" ${allPages ? 'checked' : ''}/> 本标签页全部页面</label>
      </div>
      <div class="hint">${escapeHtml(statusMsg)}</div>
      <div class="list${selectClass}">${list}</div>
    </aside>
    <div class="toast" id="toast"></div>`;
  host.style.pointerEvents = 'none';
  const ball = root.querySelector('.ball') as HTMLElement | null;
  const panel = root.querySelector('.panel') as HTMLElement | null;
  const scrim = root.querySelector('.scrim') as HTMLElement | null;
  if (ball) {
    ball.style.pointerEvents = 'auto';
  }
  if (open) {
    if (panel) {
      panel.style.pointerEvents = 'auto';
      panel.style.display = 'flex';
    }
    if (scrim) {
      scrim.style.pointerEvents = 'auto';
      scrim.style.display = 'block';
    }
  }
}

function findThread(id: string): StoredThread | undefined {
  if (!tabCache) {
    return undefined;
  }
  for (const page of Object.values(tabCache.pages)) {
    const hit = page.threads.find((t) => t.id === id);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function onRootClick(ev: Event): void {
  const target = ev.target as HTMLElement | null;
  const actEl = target?.closest?.('[data-act]') as HTMLElement | null;
  if (!actEl) {
    return;
  }
  const act = actEl.getAttribute('data-act');
  const id = actEl.getAttribute('data-id') || '';
  if (act === 'toggle') {
    ev.preventDefault();
    ev.stopPropagation();
    if (open) {
      closeDrawer();
    } else {
      openDrawer();
    }
    return;
  }
  if (act === 'close') {
    ev.preventDefault();
    closeDrawer();
    return;
  }
  if (act === 'scope') {
    allPages = (actEl as HTMLInputElement).checked;
    statusMsg = '';
    paint();
    return;
  }
  if (act === 'resolve' && id) {
    ev.preventDefault();
    ev.stopPropagation();
    handlers?.onResolve(id);
    return;
  }
  if (act === 'select' && id) {
    ev.preventDefault();
    if (!selectEnabled) {
      return;
    }
    const thread = findThread(id);
    if (thread) {
      statusMsg = '';
      selectedId = thread.id;
      handlers?.onSelect(thread);
      paint();
    }
  }
}

export function drawerOpen(): boolean {
  return open;
}

export function openDrawer(): void {
  const wasOpen = open;
  open = true;
  statusMsg = '';
  paint();
  if (!wasOpen) {
    handlers?.onOpen?.();
  }
}

export function closeDrawer(): void {
  const wasOpen = open;
  open = false;
  statusMsg = '';
  paint();
  if (wasOpen) {
    handlers?.onClose?.();
  }
}

export function setSelectEnabled(enabled: boolean): void {
  selectEnabled = enabled;
  paint();
}

export function setSelectedThreadId(id: string | null): void {
  selectedId = id;
  paint();
}

export function setDrawerStatus(msg: string): void {
  statusMsg = msg;
  paint();
}

export function mountDrawer(nextHandlers: DrawerHandlers, tab: StoredTabFile | undefined, url: string): void {
  handlers = nextHandlers;
  tabCache = tab;
  pageUrl = url;
  paint();
}

export function updateDrawer(tab: StoredTabFile | undefined, url: string): void {
  tabCache = tab;
  pageUrl = url;
  paint();
}

export function showToast(text: string): void {
  const host = ensureHost();
  paint();
  const toast = host.shadowRoot?.getElementById('toast');
  if (!toast) {
    return;
  }
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1600);
}
