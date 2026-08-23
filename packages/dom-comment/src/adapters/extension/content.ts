import { DRAG_THRESHOLD_PX, MIN_AREA_PX } from '../../core/types.js';
import { canonicalizeUrl, isHttpUrl } from '../../core/identity.js';
import { captureArea, captureElement, captureText } from './capture.js';
import {
  closeComposer,
  composerOpen,
  openComposer,
  openThreadPanel,
  setComposerError,
  setComposerHidden,
} from './composer.js';
import {
  deepestElement,
  isOurHost,
  renderOverlay,
  removeOverlay,
  setOverlayHidden,
  setPinClickHandler,
  skipTarget,
} from './highlight.js';
import { postToBackground, type ExtMessage } from './messages.js';
import { pinModels } from './relocate-dom.js';
import type { StoredTabFile, StoredThread } from '../../core/types.js';

const DRAG = DRAG_THRESHOLD_PX;
let modeOn = false;
let peeking = false;
let hoverEl: Element | null = null;
let hoverChain: Element[] = [];
let hoverIdx = 0;
let dragging = false;
let dragStart: { x: number; y: number } | null = null;
let rubber: { x: number; y: number; w: number; h: number } | null = null;
let wasDragging = false;
let pendingText = false;
let tabCache: StoredTabFile | undefined;
let pins: { x: number; y: number; w: number; h: number; area: boolean; id: string; number: number }[] = [];
let activeRect: DOMRect | null = null;
let showDraftPin = false;
let openThreadId: string | null = null;

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function intercepting(): boolean {
  return modeOn && !peeking && !composerOpen();
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return Boolean((target as HTMLElement).isContentEditable);
}

function paintOverlay(): void {
  if (!modeOn) {
    removeOverlay();
    return;
  }
  const composing = composerOpen();
  renderOverlay({
    banner: modeOn && !peeking,
    hover: rubber
      ? null
      : composing && activeRect
        ? activeRect
        : hoverEl && modeOn && !dragging && !composing && !peeking
          ? hoverEl.getBoundingClientRect()
          : null,
    rubber: modeOn && !peeking ? rubber : null,
    pins: peeking ? [] : pins,
    draft:
      showDraftPin && activeRect && !peeking
        ? { x: activeRect.left, y: activeRect.top, w: activeRect.width, h: activeRect.height }
        : null,
  });
}

function paint(): void {
  if (!modeOn) {
    removeOverlay();
    return;
  }
  paintOverlay();
}

function setMode(on: boolean): void {
  modeOn = on;
  if (!on) {
    hoverEl = null;
    hoverChain = [];
    dragging = false;
    rubber = null;
    dragStart = null;
    peeking = false;
    openThreadId = null;
    closeComposer();
    activeRect = null;
    showDraftPin = false;
    removeOverlay();
    return;
  }
  paint();
}

function findThread(id: string): StoredThread | undefined {
  if (!tabCache) {
    return undefined;
  }
  for (const page of Object.values(tabCache.pages)) {
    const thread = page.threads.find((item) => item.id === id);
    if (thread) {
      return thread;
    }
  }
  return undefined;
}

function threadRect(id: string): DOMRect {
  const pin = pins.find((item) => item.id === id);
  if (pin) {
    return new DOMRect(pin.x, pin.y, pin.w, pin.h);
  }
  if (activeRect) {
    return activeRect;
  }
  return new DOMRect(20, 20, 40, 40);
}

function refreshPins(overlayOnly = false): void {
  const { href } = location;
  if (!isHttpUrl(href) || !tabCache) {
    pins = [];
  } else {
    try {
      pins = pinModels(tabCache, canonicalizeUrl(href));
    } catch {
      pins = [];
    }
  }
  if (overlayOnly) {
    paintOverlay();
    return;
  }
  paint();
}

function askLoad(): void {
  postToBackground({ type: 'LOAD_TAB', tabId: -1 });
}

function dismissComposer(): void {
  openThreadId = null;
  setCaptureChromeHidden(false);
  closeComposer();
  rubber = null;
  activeRect = null;
  showDraftPin = false;
  paint();
}

function setCaptureChromeHidden(hidden: boolean): void {
  setOverlayHidden(hidden);
  setComposerHidden(hidden);
}

function afterPaint(sendResponse: (v: unknown) => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => sendResponse({ type: 'PREPARE_CAPTURE' }), 32);
    });
  });
}

function showThread(thread: StoredThread, rect: DOMRect): void {
  openThreadId = thread.id;
  activeRect = rect;
  showDraftPin = false;
  openThreadPanel(thread, rect, {
    onSave: (body, editId) => {
      if (editId) {
        postToBackground({
          type: 'EDIT_COMMENT',
          threadId: thread.id,
          commentId: editId,
          body,
        });
      } else {
        postToBackground({ type: 'REPLY_THREAD', threadId: thread.id, body });
      }
    },
    onDeleteComment: (commentId) => {
      postToBackground({
        type: 'DELETE_COMMENT',
        threadId: thread.id,
        commentId,
      });
    },
    onResolve: () => {
      postToBackground({ type: 'RESOLVE_THREAD', threadId: thread.id });
    },
    onCancel: dismissComposer,
  });
  paint();
}

function refreshOpenThread(): void {
  if (!openThreadId) {
    return;
  }
  const thread = findThread(openThreadId);
  if (!thread) {
    dismissComposer();
    return;
  }
  showThread(thread, threadRect(thread.id));
}

function submit(
  captured:
    | ReturnType<typeof captureElement>
    | ReturnType<typeof captureArea>
    | NonNullable<ReturnType<typeof captureText>>,
  crop: DOMRect,
): void {
  const url = canonicalizeUrl(location.href);
  openThreadId = null;
  activeRect = crop;
  showDraftPin = true;
  openComposer(
    crop,
    (body) => {
      postToBackground({
        type: 'CREATE_THREAD',
        tabId: 0,
        url,
        title: document.title,
        captured,
        cropRect: { x: crop.left, y: crop.top, width: crop.width, height: crop.height },
        dpr: window.devicePixelRatio || 1,
        body,
      });
    },
    dismissComposer,
  );
  paint();
}

function rebuildChain(el: Element | null): void {
  hoverChain = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement && cur !== document.body) {
    hoverChain.push(cur);
    cur = cur.parentElement;
  }
  hoverIdx = 0;
  hoverEl = hoverChain[0] || null;
}

function openPin(id: string): void {
  const thread = findThread(id);
  if (!thread) {
    return;
  }
  showThread(thread, threadRect(id));
}

document.addEventListener(
  'mousemove',
  (ev) => {
    if (!intercepting()) {
      return;
    }
    if (dragStart && ev.buttons === 1) {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      if (hypot(dx, dy) >= DRAG) {
        if (!dragging) {
          window.getSelection()?.removeAllRanges();
        }
        dragging = true;
        wasDragging = true;
        const x = Math.min(dragStart.x, ev.clientX);
        const y = Math.min(dragStart.y, ev.clientY);
        rubber = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
        hoverEl = null;
        ev.preventDefault();
        paintOverlay();
      }
      return;
    }
    const el = deepestElement(ev.clientX, ev.clientY);
    if (el !== hoverChain[0]) {
      rebuildChain(el);
    }
    paintOverlay();
  },
  true,
);

document.addEventListener(
  'mousedown',
  (ev) => {
    if (!intercepting() || isOurHost(ev.target) || ev.button !== 0) {
      return;
    }
    pendingText = false;
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragging = false;
    wasDragging = false;
    rubber = null;
  },
  true,
);

document.addEventListener(
  'mouseup',
  (ev) => {
    if (!modeOn || !dragStart) {
      return;
    }
    if (dragging && rubber && rubber.w >= MIN_AREA_PX && rubber.h >= MIN_AREA_PX) {
      const box = new DOMRect(rubber.x, rubber.y, rubber.w, rubber.h);
      submit(captureArea(rubber), box);
      dragStart = null;
      dragging = false;
      paint();
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    const text = !dragging ? captureText() : null;
    dragStart = null;
    dragging = false;
    rubber = null;
    paint();
    if (text) {
      pendingText = true;
      const crop = new DOMRect(
        text.rect.x - window.scrollX,
        text.rect.y - window.scrollY,
        text.rect.width,
        text.rect.height,
      );
      submit(text, crop);
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
    if (wasDragging) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  },
  true,
);

document.addEventListener(
  'click',
  (ev) => {
    if (!intercepting() || isOurHost(ev.target)) {
      return;
    }
    if (pendingText || wasDragging) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      pendingText = false;
      wasDragging = false;
      return;
    }
    const el = deepestElement(ev.clientX, ev.clientY);
    if (!el || skipTarget(el)) {
      return;
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const target = hoverEl && hoverEl.isConnected && !skipTarget(hoverEl) ? hoverEl : el;
    submit(captureElement(target), target.getBoundingClientRect());
  },
  true,
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key === 'Escape') {
      if (composerOpen()) {
        ev.preventDefault();
        dismissComposer();
        return;
      }
      if (dragging) {
        dragging = false;
        rubber = null;
        dragStart = null;
        paint();
        return;
      }
      if (modeOn) {
        ev.preventDefault();
        postToBackground({ type: 'SET_MODE_REQUEST', on: false });
      }
      return;
    }
    if (ev.key === ' ' && modeOn && !composerOpen() && !editableTarget(ev.target)) {
      peeking = true;
      ev.preventDefault();
      paint();
      setCaptureChromeHidden(true);
      return;
    }
    if (ev.altKey && intercepting() && hoverChain.length > 1 && (ev.key === 'Alt' || ev.key === 'Option')) {
      hoverIdx = Math.min(hoverChain.length - 1, hoverIdx + 1);
      hoverEl = hoverChain[hoverIdx];
      paint();
    }
  },
  true,
);

document.addEventListener(
  'keyup',
  (ev) => {
    if (ev.key === ' ' && peeking) {
      peeking = false;
      setCaptureChromeHidden(false);
      paint();
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
  if (msg.type === 'PREPARE_CAPTURE') {
    setCaptureChromeHidden(true);
    afterPaint(sendResponse);
    return true;
  }
  if (msg.type === 'SET_MODE') {
    setMode(msg.on);
  }
  if (msg.type === 'SET_FOCUS_THREAD') {
    if (!modeOn) {
      setMode(true);
    }
    openPin(msg.threadId);
  }
  if (msg.type === 'CREATE_THREAD_RESULT') {
    setCaptureChromeHidden(false);
    if (msg.ok && msg.thread) {
      const rect = activeRect || threadRect(msg.thread.id);
      showThread(msg.thread, rect);
    } else if (!msg.ok) {
      setComposerError(msg.error || '保存失败');
      paint();
    }
  }
  if (msg.type === 'LOAD_TAB_RESULT' && msg.ok) {
    tabCache = msg.tab;
    refreshPins();
    refreshOpenThread();
  }
  if (msg.type === 'THREADS_CHANGED') {
    askLoad();
  }
  if (msg.type === 'HOST_ERROR') {
    setCaptureChromeHidden(false);
    setComposerError(msg.message);
    paint();
  }
  return undefined;
});

chrome.storage.session.get('annotationMode').then((v) => {
  setMode(Boolean(v.annotationMode));
});
chrome.storage.session.onChanged.addListener((c) => {
  if (c.annotationMode) {
    setMode(Boolean(c.annotationMode.newValue));
  }
});

setPinClickHandler(openPin);
askLoad();
window.addEventListener('scroll', () => refreshPins(true), { passive: true });
window.addEventListener('resize', () => refreshPins(true));
