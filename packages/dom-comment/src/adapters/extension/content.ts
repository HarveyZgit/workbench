import { DRAG_THRESHOLD_PX, MIN_AREA_PX } from '../../core/types.js';
import { canonicalizeUrl, isHttpUrl } from '../../core/identity.js';
import { captureArea, captureElement } from './capture.js';
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
let hoverEl: Element | null = null;
let dragging = false;
let dragStart: { x: number; y: number } | null = null;
let rubber: { x: number; y: number; w: number; h: number } | null = null;
let wasDragging = false;
let tabCache: StoredTabFile | undefined;
let pins: { x: number; y: number; w: number; h: number; area: boolean; id: string }[] = [];
let activeRect: DOMRect | null = null;
let showDraftPin = false;

function paint(): void {
  if (!modeOn) {
    removeOverlay();
    return;
  }
  const composing = composerOpen();
  renderOverlay({
    banner: true,
    hover: rubber
      ? null
      : composing && activeRect
        ? activeRect
        : hoverEl && !dragging && !composing
          ? hoverEl.getBoundingClientRect()
          : null,
    rubber,
    pins,
    draft:
      showDraftPin && activeRect
        ? { x: activeRect.left, y: activeRect.top, w: activeRect.width, h: activeRect.height }
        : null,
  });
}

function setMode(on: boolean): void {
  modeOn = on;
  if (!on) {
    hoverEl = null;
    dragging = false;
    rubber = null;
    activeRect = null;
    showDraftPin = false;
    closeComposer();
  }
  paint();
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function refreshPins(): void {
  const {href} = location;
  if (!isHttpUrl(href) || !tabCache) {
    pins = [];
    paint();
    return;
  }
  try {
    pins = pinModels(tabCache, canonicalizeUrl(href));
  } catch {
    pins = [];
  }
  paint();
}

function askLoad(): void {
  postToBackground({ type: 'LOAD_TAB', tabId: -1 });
}

function dismissComposer(): void {
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

function submit(
  captured: ReturnType<typeof captureElement> | ReturnType<typeof captureArea>,
  crop: DOMRect,
): void {
  const url = canonicalizeUrl(location.href);
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

function openPin(id: string): void {
  if (!tabCache) {
    return;
  }
  let thread: StoredThread | undefined;
  for (const page of Object.values(tabCache.pages)) {
    thread = page.threads.find((item) => item.id === id);
    if (thread) {
      break;
    }
  }
  if (!thread) {
    return;
  }
  const current = thread;
  const pin = pins.find((p) => p.id === id);
  const rect = pin ? new DOMRect(pin.x, pin.y, pin.w, pin.h) : new DOMRect(20, 20, 40, 40);
  activeRect = rect;
  showDraftPin = false;
  openThreadPanel(current, rect, {
    onSave: (body, editId) => {
      if (editId) {
        postToBackground({
          type: 'EDIT_COMMENT',
          threadId: current.id,
          commentId: editId,
          body,
        });
      } else {
        postToBackground({ type: 'REPLY_THREAD', threadId: current.id, body });
      }
    },
    onResolve: () => {
      postToBackground({ type: 'RESOLVE_THREAD', threadId: current.id });
    },
    onCancel: dismissComposer,
  });
  paint();
}

document.addEventListener(
  'mousemove',
  (ev) => {
    if (!modeOn || composerOpen()) {
      return;
    }
    if (dragStart && ev.buttons === 1) {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      if (hypot(dx, dy) >= DRAG) {
        dragging = true;
        wasDragging = true;
        const x = Math.min(dragStart.x, ev.clientX);
        const y = Math.min(dragStart.y, ev.clientY);
        rubber = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
        hoverEl = null;
        paint();
      }
      return;
    }
    const el = deepestElement(ev.clientX, ev.clientY);
    hoverEl = el;
    paint();
  },
  true,
);

document.addEventListener(
  'mousedown',
  (ev) => {
    if (!modeOn || composerOpen() || isOurHost(ev.target) || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
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
      if (wasDragging) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
      return;
    }
    dragStart = null;
    dragging = false;
    rubber = null;
    paint();
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
    if (!modeOn || composerOpen() || isOurHost(ev.target)) {
      return;
    }
    if (wasDragging) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      wasDragging = false;
      return;
    }
    const el = deepestElement(ev.clientX, ev.clientY);
    if (!el || skipTarget(el)) {
      return;
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    submit(captureElement(el), el.getBoundingClientRect());
  },
  true,
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key !== 'Escape') {
      return;
    }
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
  if (msg.type === 'CREATE_THREAD_RESULT') {
    if (msg.ok) {
      dismissComposer();
    } else {
      setCaptureChromeHidden(false);
      setComposerError(msg.error || '保存失败');
    }
  }
  if (msg.type === 'LOAD_TAB_RESULT' && msg.ok) {
    tabCache = msg.tab;
    refreshPins();
  }
  if (msg.type === 'THREADS_CHANGED') {
    dismissComposer();
    askLoad();
  }
  if (msg.type === 'HOST_ERROR') {
    setCaptureChromeHidden(false);
    setComposerError(msg.message);
  }
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
window.addEventListener('scroll', paint, { passive: true });
window.addEventListener('resize', () => {
  refreshPins();
});
