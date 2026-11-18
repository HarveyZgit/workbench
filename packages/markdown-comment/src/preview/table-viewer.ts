const EXPAND_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3H3v3m7-3h3v3M3 10v3h3m7-3v3h-3"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>';

interface TableView {
  element: HTMLDialogElement;
  slot: HTMLElement;
  scroller: HTMLElement;
  table: HTMLTableElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  footer: HTMLElement;
  source: boolean;
}

interface TableSelection {
  anchor: number;
  focus: number;
  text: string;
}

interface ViewerSnapshot {
  index: number;
  commentId: string | undefined;
  source: boolean;
  text: string;
  line: string | undefined;
  top: number;
  left: number;
  selection: TableSelection | undefined;
  hasDraft: boolean;
  focus: HTMLElement | undefined;
}

function selectedOffsets(table: HTMLTableElement): TableSelection | undefined {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  if (
    !selection ||
    !anchor ||
    !focus ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !table.contains(anchor) ||
    !table.contains(focus)
  ) {
    return undefined;
  }
  function offset(node: Node, count: number): number {
    const prefix = document.createRange();
    prefix.selectNodeContents(table);
    prefix.setEnd(node, count);
    return prefix.toString().length;
  }
  return {
    anchor: offset(anchor, selection.anchorOffset),
    focus: offset(focus, selection.focusOffset),
    text: selection.getRangeAt(0).toString(),
  };
}

function applyOffsets(table: HTMLTableElement, saved: TableSelection | undefined): void {
  if (!saved) {
    return;
  }
  const selection = window.getSelection();
  const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let anchor: [Node, number] | undefined;
  let focus: [Node, number] | undefined;
  // Prefer the next text node for the lower boundary and the previous for the upper boundary.
  // This avoids restoring an endpoint into separator whitespace if an adjacent cell starts there.
  function hasOffset(value: number, length: number, isStart: boolean): boolean {
    return value >= cursor && (isStart ? value < cursor + length : value <= cursor + length);
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!length) {
      continue;
    }
    if (!anchor && hasOffset(saved.anchor, length, saved.anchor < saved.focus)) {
      anchor = [node, saved.anchor - cursor];
    }
    if (!focus && hasOffset(saved.focus, length, saved.focus < saved.anchor)) {
      focus = [node, saved.focus - cursor];
    }
    cursor += length;
  }
  const lo = Math.min(saved.anchor, saved.focus);
  const hi = Math.max(saved.anchor, saved.focus);
  if (anchor && focus && table.textContent?.slice(lo, hi) === saved.text) {
    selection?.setBaseAndExtent(...anchor, ...focus);
  }
}

function action(title: string, icon: string, extraClass: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `mdc-table-action ${extraClass}`;
  button.setAttribute('aria-label', title);
  button.title = title;
  button.innerHTML = icon;
  return button;
}

function buildTableView(table: HTMLTableElement, source: boolean): TableView {
  const slot = document.createElement('div');
  slot.className = 'mdc-table-slot';
  const element = document.createElement('dialog');
  element.className = 'mdc-table-view';
  element.setAttribute('aria-label', '表格');
  element.setAttribute('role', 'group');
  const tools = document.createElement('div');
  tools.className = 'mdc-table-tools';
  const openButton = action('全屏查看表格', EXPAND_ICON, 'mdc-table-expand');
  openButton.setAttribute('aria-haspopup', 'dialog');
  const closeButton = action('关闭全屏表格', CLOSE_ICON, 'mdc-table-close');
  closeButton.autofocus = true;
  tools.append(openButton, closeButton);
  const scroller = document.createElement('div');
  scroller.className = 'mdc-table-scroll';
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', '表格内容');
  const footer = document.createElement('div');
  footer.className = 'mdc-table-draft';
  const view = { element, slot, scroller, table, openButton, closeButton, footer, source };
  table.replaceWith(slot);
  slot.append(element);
  element.append(tools, scroller, footer);
  scroller.append(table);
  return view;
}

function wireTableControls(
  view: TableView,
  isActive: () => boolean,
  open: () => void,
  close: () => void,
): void {
  const { element, openButton, closeButton } = view;
  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isActive() && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    true,
  );
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (isActive()) {
      close();
    }
  });
  element.addEventListener('close', () => {
    if (isActive() && !element.open) {
      close();
    }
  });
}

function commentId(element: HTMLDialogElement): string | undefined {
  return element.closest<HTMLElement>('.mdc-cmt[data-comment-id]')?.dataset.commentId;
}

function captureViewer(view: TableView, index: number, draft: HTMLElement | null): ViewerSnapshot {
  const { source, element, table, scroller, footer } = view;
  const focused = document.activeElement;
  return {
    index,
    commentId: commentId(element),
    source,
    text: table.textContent ?? '',
    line: table.dataset.line,
    left: scroller.scrollLeft,
    top: scroller.scrollTop,
    selection: selectedOffsets(table),
    hasDraft: draft?.parentElement === footer,
    focus: focused instanceof HTMLElement && draft?.contains(focused) ? focused : undefined,
  };
}

function findMatchingView(
  elements: HTMLDialogElement[],
  views: WeakMap<HTMLDialogElement, TableView>,
  snapshot: ViewerSnapshot,
): TableView | undefined {
  const matching = elements
    .map((element) => views.get(element))
    .filter((view): view is TableView => view?.table.textContent === snapshot.text);
  return (
    matching.find(
      (candidate) =>
        candidate.table.dataset.line === snapshot.line && elements[snapshot.index] === candidate.element,
    ) ?? (matching.length === 1 ? matching[0] : undefined)
  );
}

export function createTableViewer(options: {
  sourceRoot: HTMLElement | null;
  commentRoot: HTMLElement | null;
  draft: HTMLElement | null;
  onChange: (element: HTMLDialogElement | undefined, source: boolean) => void;
}) {
  const views = new WeakMap<HTMLDialogElement, TableView>();
  const draftParent = options.draft?.parentElement;
  const draftNext = options.draft?.nextSibling;
  let active: TableView | undefined;

  function close(restoreFocus = true): void {
    if (!active) {
      return;
    }
    const old = active;
    const selection = selectedOffsets(old.table);
    const hasDraft = options.draft?.parentElement === old.footer;
    active = undefined;
    if (hasDraft && options.draft) {
      draftParent?.insertBefore(options.draft, draftNext ?? null);
    }
    if (old.element.open) {
      old.element.close();
    }
    old.slot.style.removeProperty('min-height');
    old.element.setAttribute('role', 'group');
    options.onChange(undefined, false);
    if (restoreFocus) {
      old.openButton.focus({ preventScroll: true });
      applyOffsets(old.table, selection);
    }
  }

  function open(view: TableView): void {
    if (active || !view.element.isConnected || typeof view.element.showModal !== 'function') {
      return;
    }
    active = view;
    // Reserve the original table's place in the document while the native
    // dialog is out of normal flow. Closing it shouldn't jump the preview.
    view.slot.style.minHeight = `${view.element.getBoundingClientRect().height}px`;
    view.element.removeAttribute('role');
    view.element.showModal();
    options.onChange(view.element, view.source);
    view.closeButton.focus({ preventScroll: true });
  }

  function wrap(root: HTMLElement | null, source: boolean): void {
    for (const table of Array.from(root?.querySelectorAll<HTMLTableElement>('table') ?? [])) {
      if (table.parentElement?.closest('table, .mdc-table-view')) {
        continue;
      }
      const view = buildTableView(table, source);
      views.set(view.element, view);
      wireTableControls(
        view,
        () => active === view,
        () => open(view),
        close,
      );
    }
  }

  function adoptDraft(): void {
    if (active?.source && options.draft) {
      active.footer.append(options.draft);
    }
  }

  function currentViews(source: boolean, id?: string): HTMLDialogElement[] {
    const root = source ? options.sourceRoot : options.commentRoot;
    return Array.from(root?.querySelectorAll<HTMLDialogElement>('.mdc-table-view') ?? []).filter(
      (element) => views.has(element) && (source || commentId(element) === id),
    );
  }

  function suspend(): ViewerSnapshot | undefined {
    if (!active) {
      return undefined;
    }
    const { source, element } = active;
    const index = currentViews(source, commentId(element)).indexOf(element);
    const snapshot = captureViewer(active, index, options.draft);
    close(false);
    return snapshot;
  }

  function restore(snapshot: ViewerSnapshot | undefined): void {
    if (!snapshot) {
      return;
    }
    const elements = currentViews(snapshot.source, snapshot.commentId);
    const view = findMatchingView(elements, views, snapshot);
    if (!view) {
      const fallback = snapshot.focus?.isConnected ? snapshot.focus : options.sourceRoot;
      fallback?.focus({ preventScroll: true });
      return;
    }
    open(view);
    if (snapshot.hasDraft) {
      adoptDraft();
      snapshot.focus?.focus({ preventScroll: true });
    }
    view.scroller.scrollTop = snapshot.top;
    view.scroller.scrollLeft = snapshot.left;
    applyOffsets(view.table, snapshot.selection);
  }

  return {
    wrap,
    adoptDraft,
    suspend,
    restore,
    isOpen: () => !!active,
    refocusAfterDraft: () => active?.closeButton.focus({ preventScroll: true }),
    sourceSelection: () => (active?.source ? selectedOffsets(active.table) : undefined),
    restoreSourceSelection: (saved: TableSelection | undefined) => {
      if (active?.source) {
        applyOffsets(active.table, saved);
      }
    },
  };
}
