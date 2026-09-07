import { DRAG_THRESHOLD_PX, MIN_AREA_PX } from '../../core/types.js';
import { canonicalizeUrl, isAnnotatableUrl } from '../../core/identity.js';
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
  closeDrawer,
  drawerOpen,
  mountDrawer,
  openDrawer,
  setDrawerStatus,
  setSelectEnabled,
  setSelectedThreadId,
  showToast,
  updateDrawer,
} from './drawer.js';
import {
  deepestElement,
  isOurHost,
  renderOverlay,
  removeOverlay,
  setOverlayHidden,
  setPinClickHandler,
  skipTarget,
} from './highlight.js';
import { resolveEscapeAction } from './esc-policy.js';
import {
  areaPinsShouldBeInteractive,
  canOpenPinForEdit,
  drawerCardsShouldSelect,
  pinsShouldBeInteractive,
} from './pin-policy.js';
import { postToBackground, type ExtMessage } from './messages.js';
import { locateAnchor, pinModels } from './relocate-dom.js';
import { skillPromptForTab } from '../../core/markdown.js';
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
let allowTextSelect = false;
let tabCache: StoredTabFile | undefined;
let pins: { x: number; y: number; w: number; h: number; area: boolean; id: string; number: number }[] = [];
let activeRect: DOMRect | null = null;
let showDraftPin = false;
let openThreadId: string | null = null;
/** Browse-mode selected thread (sidebar / pin); drives persistent region highlight. */
let selectedThreadId: string | null = null;
let selectedHighlight: DOMRect | null = null;

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function intercepting(): boolean {
  return modeOn && !peeking && !composerOpen();
}

const NON_TEXT_INPUT = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'hidden',
  'image',
  'color',
  'range',
  'password',
]);

/** True when the pointer is on a caret-capable text run (so a drag should select, not rubber-band). */
function startedOnSelectableText(ev: MouseEvent): boolean {
  const t = ev.target;
  if (t instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT.has(t.type.toLowerCase());
  }
  if (t instanceof HTMLTextAreaElement) {
    return true;
  }
  if (t instanceof HTMLElement && t.isContentEditable) {
    return true;
  }
  const range = document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return false;
  }
  if (!range.startContainer.textContent?.trim()) {
    return false;
  }
  const parent = range.startContainer.parentElement;
  if (!parent || skipTarget(parent)) {
    return false;
  }
  return getComputedStyle(parent).userSelect !== 'none';
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
  const composing = composerOpen();
  // Browse pins/highlight only while the sidebar is open (not merely because mode is off).
  const showBrowse = !modeOn && drawerOpen() && (pins.length > 0 || selectedHighlight !== null);
  if (!modeOn && !showBrowse) {
    removeOverlay();
    return;
  }
  const pinOpts = { modeOn, peeking, drawerOpen: drawerOpen() };
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
    // Annotate: badges reopen threads for edit; browse: pins only while drawer open.
    pinsInteractive: pinsShouldBeInteractive(pinOpts),
    areaPinsInteractive: areaPinsShouldBeInteractive(pinOpts),
    selected: !modeOn && !peeking ? selectedHighlight : null,
    draft:
      showDraftPin && activeRect && !peeking
        ? { x: activeRect.left, y: activeRect.top, w: activeRect.width, h: activeRect.height }
        : null,
  });
}

function paint(): void {
  paintOverlay();
}

function clearBrowseSelection(): void {
  selectedThreadId = null;
  selectedHighlight = null;
  setSelectedThreadId(null);
}

function applySidebarModePolicy(): void {
  // Policy applies when the drawer is open; never auto-opens the drawer on mode toggle.
  if (modeOn) {
    clearBrowseSelection();
  }
  // Cards reopen for edit in annotate and browse (same as numbered pins).
  setSelectEnabled(drawerCardsShouldSelect(modeOn, drawerOpen()));
  paint();
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
    allowTextSelect = false;
    openThreadId = null;
    closeComposer();
    activeRect = null;
    showDraftPin = false;
    applySidebarModePolicy();
    return;
  }
  applySidebarModePolicy();
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
  if (!isAnnotatableUrl(href) || !tabCache) {
    pins = [];
  } else {
    try {
      pins = pinModels(tabCache, canonicalizeUrl(href));
    } catch {
      pins = [];
    }
  }
  if (selectedThreadId) {
    const pin = pins.find((item) => item.id === selectedThreadId);
    selectedHighlight = pin ? new DOMRect(pin.x, pin.y, pin.w, pin.h) : selectedHighlight;
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

function currentPageUrl(): string {
  const { href } = location;
  return isAnnotatableUrl(href) ? canonicalizeUrl(href) : '';
}

function promptText(tabId: number, href: string): string {
  return skillPromptForTab(tabId, href);
}

function resolveThreadRect(thread: StoredThread): DOMRect | null {
  const pin = pins.find((item) => item.id === thread.id);
  if (pin) {
    return new DOMRect(pin.x, pin.y, pin.w, pin.h);
  }
  const hit = locateAnchor(thread.anchor);
  return hit?.rect ?? null;
}

function selectThread(thread: StoredThread): void {
  const rect = resolveThreadRect(thread);
  if (!rect) {
    setDrawerStatus('找不到该评论的锚点（可能已失效）');
    return;
  }
  selectedThreadId = thread.id;
  selectedHighlight = rect;
  setSelectedThreadId(thread.id);
  const absTop = rect.top + window.scrollY;
  window.scrollTo({ top: Math.max(0, absTop - window.innerHeight / 3), behavior: 'smooth' });
  setDrawerStatus('');
  paint();
}

function bindDrawer(): void {
  mountDrawer(
    {
      onResolve: (threadId) => {
        postToBackground({ type: 'RESOLVE_THREAD', threadId });
      },
      onSelect: (thread) => {
        // Browse: scroll + persistent highlight. Annotate and browse: open thread panel (like pins).
        if (!modeOn) {
          selectThread(thread);
        } else {
          setSelectedThreadId(thread.id);
        }
        const rect = resolveThreadRect(thread);
        if (rect) {
          showThread(thread, rect);
        } else if (modeOn) {
          setDrawerStatus('找不到该评论的锚点（可能已失效）');
        }
      },
      onOpen: () => {
        applySidebarModePolicy();
      },
      onClose: () => {
        clearBrowseSelection();
        paint();
      },
    },
    tabCache,
    currentPageUrl(),
  );
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
  // Annotate: pin reopens for edit (page clicks still create). Browse: require drawer open.
  if (!canOpenPinForEdit(modeOn, drawerOpen())) {
    return;
  }
  const rect = resolveThreadRect(thread) || threadRect(id);
  if (!modeOn) {
    selectThread(thread);
  }
  showThread(thread, rect);
}

/** Agent / SET_FOCUS_THREAD: enter annotate and open the thread composer. */
function focusThread(id: string): void {
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
        if (allowTextSelect) {
          dragging = false;
          rubber = null;
          return;
        }
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
    allowTextSelect = startedOnSelectableText(ev);
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
    const text = captureText();
    if (text) {
      pendingText = true;
      allowTextSelect = false;
      const crop = new DOMRect(
        text.rect.x - window.scrollX,
        text.rect.y - window.scrollY,
        text.rect.width,
        text.rect.height,
      );
      submit(text, crop);
      dragStart = null;
      dragging = false;
      rubber = null;
      paint();
      ev.preventDefault();
      ev.stopImmediatePropagation();
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
    if (!modeOn || peeking || isOurHost(ev.target)) {
      return;
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (pendingText || wasDragging) {
      pendingText = false;
      wasDragging = false;
      return;
    }
    if (composerOpen()) {
      return;
    }
    const el = deepestElement(ev.clientX, ev.clientY);
    if (!el || skipTarget(el)) {
      return;
    }
    const target = hoverEl && hoverEl.isConnected && !skipTarget(hoverEl) ? hoverEl : el;
    submit(captureElement(target), target.getBoundingClientRect());
  },
  true,
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key === 'Escape') {
      const action = resolveEscapeAction({
        composerOpen: composerOpen(),
        drawerOpen: drawerOpen(),
        dragging,
        modeOn,
      });
      if (action === 'composer') {
        ev.preventDefault();
        dismissComposer();
        return;
      }
      if (action === 'drawer') {
        ev.preventDefault();
        closeDrawer();
        return;
      }
      if (action === 'rubber') {
        dragging = false;
        rubber = null;
        dragStart = null;
        paint();
        return;
      }
      if (action === 'mode') {
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
    focusThread(msg.threadId);
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
    updateDrawer(tabCache, currentPageUrl());
  }
  if (msg.type === 'THREADS_CHANGED') {
    askLoad();
  }
  if (msg.type === 'OPEN_DRAWER') {
    openDrawer();
  }
  if (msg.type === 'COPY_SKILL_PROMPT') {
    if (msg.copied) {
      showToast('已复制 skill prompt');
      return undefined;
    }
    const text = promptText(msg.tabId, msg.url || location.href);
    void navigator.clipboard.writeText(text).then(
      () => showToast('已复制 skill prompt'),
      () => showToast('复制失败'),
    );
  }
  if (msg.type === 'HOST_ERROR') {
    setCaptureChromeHidden(false);
    setComposerError(msg.message);
    paint();
  }
  return undefined;
});

setPinClickHandler(openPin);
bindDrawer();
askLoad();
window.addEventListener('scroll', () => refreshPins(true), { passive: true });
window.addEventListener('resize', () => refreshPins(true));
