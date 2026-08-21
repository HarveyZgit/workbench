/// <reference lib="dom" />

const SOURCE_BLOCK_SELECTOR = '.mdc-source-block[data-line][data-end-line]';
const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, option, summary, [contenteditable="true"]';

export interface PreviewScrollAnchor {
  sourceLine: number;
  sourceEndLine?: number;
  tagName?: string;
  ordinal?: number;
  blockRatio: number;
}

export interface PreviewDetailsState {
  sourceLine: number;
  summary: string;
  open: boolean;
}

export interface PreviewNavigationState {
  scroll?: PreviewScrollAnchor;
  details: PreviewDetailsState[];
}

export interface PreviewNavigationOptions {
  onPreviewScroll?: (sourceLine: number) => void;
  onRevealSourceLine?: (sourceLine: number) => void;
  onOpenLink?: (href: string) => void;
  scrollThrottleMs?: number;
  suppressionMs?: number;
}

export interface PreviewNavigation {
  scrollToSourceLine: (sourceLine: number) => void;
  getCurrentSourceLine: () => number | undefined;
  captureState: () => PreviewNavigationState;
  restoreState: (state: PreviewNavigationState) => void;
  dispose: () => void;
}

interface SourceBlock {
  element: HTMLElement;
  startLine: number;
  endLine: number;
  depth: number;
  rect: DOMRect;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function sourceLine(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function duration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function blockDepth(element: HTMLElement, root: HTMLElement): number {
  let depth = 0;
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function readSourceBlock(element: HTMLElement, root: HTMLElement): SourceBlock | undefined {
  const startLine = Number(element.dataset.line);
  const endLine = Number(element.dataset.endLine);
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine <= startLine || rect.height <= 0) {
    return undefined;
  }
  return {
    element,
    startLine: Math.max(0, Math.floor(startLine)),
    endLine: Math.max(1, Math.floor(endLine)),
    depth: blockDepth(element, root),
    rect,
  };
}

function sourceBlocks(root: HTMLElement): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR).forEach((element) => {
    const block = readSourceBlock(element, root);
    if (block) {
      blocks.push(block);
    }
  });
  return blocks;
}

function isMoreSpecific(candidate: SourceBlock, current: SourceBlock): boolean {
  const candidateSpan = candidate.endLine - candidate.startLine;
  const currentSpan = current.endLine - current.startLine;
  return candidateSpan < currentSpan || (candidateSpan === currentSpan && candidate.depth > current.depth);
}

function blockForSourceLine(blocks: SourceBlock[], line: number): SourceBlock | undefined {
  let containing: SourceBlock | undefined;
  for (const block of blocks) {
    if (
      block.startLine <= line &&
      line < block.endLine &&
      (!containing || isMoreSpecific(block, containing))
    ) {
      containing = block;
    }
  }
  if (containing) {
    return containing;
  }

  let nearest: SourceBlock | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const distance = line < block.startLine ? block.startLine - line : line - block.endLine + 1;
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && nearest && isMoreSpecific(block, nearest)) ||
      (distance === nearestDistance && nearest && block.startLine < nearest.startLine)
    ) {
      nearest = block;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function blockAtScrollTop(root: HTMLElement, blocks: SourceBlock[]): SourceBlock | undefined {
  const top = root.getBoundingClientRect().top + 1;
  let previous: SourceBlock | undefined;
  let next: SourceBlock | undefined;

  for (const block of blocks) {
    if (block.rect.top <= top) {
      if (
        !previous ||
        block.rect.top > previous.rect.top ||
        (block.rect.top === previous.rect.top && isMoreSpecific(block, previous))
      ) {
        previous = block;
      }
    } else if (
      !next ||
      block.rect.top < next.rect.top ||
      (block.rect.top === next.rect.top && isMoreSpecific(block, next))
    ) {
      next = block;
    }
  }

  return previous ?? next;
}

function ratioWithinBlock(block: SourceBlock, viewportY: number): number {
  return clamp((viewportY - block.rect.top) / block.rect.height, 0, 1);
}

function lineWithinBlock(block: SourceBlock, ratio: number): number {
  const lineCount = block.endLine - block.startLine;
  return block.startLine + Math.min(lineCount - 1, Math.floor(clamp(ratio, 0, 1) * lineCount));
}

function summaryText(details: HTMLDetailsElement): string {
  const summary = Array.from(details.children).find((child) => child.tagName === 'SUMMARY');
  return (summary?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function detailsSourceLine(details: HTMLDetailsElement): number | undefined {
  const element = details.matches(SOURCE_BLOCK_SELECTOR)
    ? details
    : (details.querySelector<HTMLElement>(SOURCE_BLOCK_SELECTOR) ??
      details.closest<HTMLElement>(SOURCE_BLOCK_SELECTOR));
  if (!element) {
    return undefined;
  }
  const line = Number(element.dataset.line);
  return Number.isFinite(line) ? Math.max(0, Math.floor(line)) : undefined;
}

function detailsKey(state: Pick<PreviewDetailsState, 'sourceLine' | 'summary'>): string {
  return `${state.sourceLine}\u0000${state.summary}`;
}

function eventElement(event: Event): Element | undefined {
  return event.target instanceof Element ? event.target : undefined;
}

export function createPreviewNavigation(
  root: HTMLElement,
  options: PreviewNavigationOptions = {},
): PreviewNavigation {
  const view = root.ownerDocument.defaultView;
  if (!view) {
    throw new Error('Preview navigation requires a browser window');
  }

  const throttleMs = duration(options.scrollThrottleMs, 100);
  const suppressionMs = duration(options.suppressionMs, 160);
  let disposed = false;
  let suppressedUntil = 0;
  let lastReportedAt = Number.NEGATIVE_INFINITY;
  let lastReportedLine: number | undefined;
  let reportFrame: number | undefined;
  let reportTimer: number | undefined;

  const getScrollAnchor = (): PreviewScrollAnchor | undefined => {
    const rootRect = root.getBoundingClientRect();
    const blocks = sourceBlocks(root);
    const block = blockAtScrollTop(root, blocks);
    if (!block) {
      return undefined;
    }
    const peers = blocks.filter(
      (candidate) =>
        candidate.startLine === block.startLine &&
        candidate.endLine === block.endLine &&
        candidate.element.tagName === block.element.tagName,
    );
    return {
      sourceLine: block.startLine,
      sourceEndLine: block.endLine,
      tagName: block.element.tagName,
      ordinal: peers.indexOf(block),
      blockRatio: ratioWithinBlock(block, rootRect.top + 1),
    };
  };

  const getCurrentSourceLine = (): number | undefined => {
    const anchor = getScrollAnchor();
    if (!anchor) {
      return undefined;
    }
    const block = blockForSourceLine(sourceBlocks(root), anchor.sourceLine);
    return block ? lineWithinBlock(block, anchor.blockRatio) : anchor.sourceLine;
  };

  const clearScheduledReport = (): void => {
    if (reportFrame !== undefined) {
      view.cancelAnimationFrame(reportFrame);
      reportFrame = undefined;
    }
    if (reportTimer !== undefined) {
      view.clearTimeout(reportTimer);
      reportTimer = undefined;
    }
  };

  const suppressReports = (): void => {
    suppressedUntil = view.performance.now() + suppressionMs;
    clearScheduledReport();
  };

  const reportScroll = (): void => {
    if (disposed || view.performance.now() < suppressedUntil) {
      return;
    }
    const line = getCurrentSourceLine();
    if (line === undefined || line === lastReportedLine) {
      return;
    }
    lastReportedLine = line;
    lastReportedAt = view.performance.now();
    options.onPreviewScroll?.(line);
  };

  const scheduleScrollReport = (): void => {
    if (
      disposed ||
      view.performance.now() < suppressedUntil ||
      reportFrame !== undefined ||
      reportTimer !== undefined
    ) {
      return;
    }
    const wait = Math.max(0, lastReportedAt + throttleMs - view.performance.now());
    if (wait > 0) {
      reportTimer = view.setTimeout(() => {
        reportTimer = undefined;
        reportScroll();
      }, wait);
      return;
    }
    reportFrame = view.requestAnimationFrame(() => {
      reportFrame = undefined;
      reportScroll();
    });
  };

  const scrollToBlock = (block: SourceBlock, ratio: number): void => {
    const rootRect = root.getBoundingClientRect();
    const blockTop = root.scrollTop + block.rect.top - rootRect.top;
    const top = blockTop + block.rect.height * clamp(ratio, 0, 1);
    root.scrollTo({
      top: clamp(top, 0, Math.max(0, root.scrollHeight - root.clientHeight)),
      behavior: 'auto',
    });
  };

  const scrollToSourceLine = (value: number): void => {
    if (disposed) {
      return;
    }
    const line = sourceLine(value);
    const block = blockForSourceLine(sourceBlocks(root), line);
    if (!block) {
      return;
    }
    suppressReports();
    const ratio =
      block.startLine <= line && line < block.endLine
        ? (line - block.startLine) / (block.endLine - block.startLine)
        : 0;
    scrollToBlock(block, ratio);
    lastReportedLine = getCurrentSourceLine();
  };

  const captureState = (): PreviewNavigationState => {
    const details: PreviewDetailsState[] = [];
    root.querySelectorAll<HTMLDetailsElement>('details').forEach((element) => {
      const line = detailsSourceLine(element);
      if (line !== undefined) {
        details.push({
          sourceLine: line,
          summary: summaryText(element),
          open: element.open,
        });
      }
    });
    return {
      scroll: getScrollAnchor(),
      details,
    };
  };

  const restoreDetails = (states: PreviewDetailsState[]): void => {
    const saved = new Map<string, boolean[]>();
    for (const state of states) {
      if (
        !Number.isFinite(state.sourceLine) ||
        typeof state.summary !== 'string' ||
        typeof state.open !== 'boolean'
      ) {
        continue;
      }
      const key = detailsKey({ sourceLine: sourceLine(state.sourceLine), summary: state.summary });
      const values = saved.get(key) ?? [];
      values.push(state.open);
      saved.set(key, values);
    }

    root.querySelectorAll<HTMLDetailsElement>('details').forEach((element) => {
      const line = detailsSourceLine(element);
      if (line === undefined) {
        return;
      }
      const values = saved.get(detailsKey({ sourceLine: line, summary: summaryText(element) }));
      const open = values?.shift();
      if (open !== undefined) {
        element.open = open;
      }
    });
  };

  const restoreState = (state: PreviewNavigationState): void => {
    if (disposed) {
      return;
    }
    suppressReports();
    restoreDetails(Array.isArray(state.details) ? state.details : []);
    if (
      state.scroll &&
      Number.isFinite(state.scroll.sourceLine) &&
      Number.isFinite(state.scroll.blockRatio)
    ) {
      const blocks = sourceBlocks(root);
      const exactBlocks = blocks.filter(
        (candidate) =>
          candidate.startLine === sourceLine(state.scroll?.sourceLine ?? 0) &&
          (state.scroll?.sourceEndLine === undefined || candidate.endLine === state.scroll.sourceEndLine) &&
          (state.scroll?.tagName === undefined || candidate.element.tagName === state.scroll.tagName),
      );
      const ordinal = Math.max(0, Math.floor(state.scroll.ordinal ?? 0));
      const block =
        exactBlocks[ordinal] ??
        exactBlocks[0] ??
        blockForSourceLine(blocks, sourceLine(state.scroll.sourceLine));
      if (block) {
        scrollToBlock(block, state.scroll.blockRatio);
      }
    }
    lastReportedLine = getCurrentSourceLine();
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (disposed || event.defaultPrevented) {
      return;
    }
    const target = eventElement(event);
    if (!target || target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    const element = target.closest<HTMLElement>(SOURCE_BLOCK_SELECTOR);
    if (!element || !root.contains(element)) {
      return;
    }
    const block = readSourceBlock(element, root);
    if (!block) {
      return;
    }
    options.onRevealSourceLine?.(lineWithinBlock(block, ratioWithinBlock(block, event.clientY)));
  };

  const onLinkClick = (event: MouseEvent): void => {
    if (disposed || event.defaultPrevented || event.button !== 0) {
      return;
    }
    const link = eventElement(event)?.closest<HTMLAnchorElement>('a[href]');
    if (!link || !root.contains(link)) {
      return;
    }
    const href = link.getAttribute('href') ?? '';
    event.preventDefault();
    if (!href.startsWith('#')) {
      options.onOpenLink?.(href);
      return;
    }
    if (href === '#') {
      root.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch {
      return;
    }
    const heading = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!heading || !/^H[1-6]$/.test(heading.tagName)) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const top = root.scrollTop + headingRect.top - rootRect.top;
    root.scrollTo({
      top: clamp(top, 0, Math.max(0, root.scrollHeight - root.clientHeight)),
      behavior: 'auto',
    });
  };

  root.addEventListener('scroll', scheduleScrollReport, { passive: true });
  root.addEventListener('dblclick', onDoubleClick);
  root.addEventListener('click', onLinkClick);

  return {
    scrollToSourceLine,
    getCurrentSourceLine,
    captureState,
    restoreState,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearScheduledReport();
      root.removeEventListener('scroll', scheduleScrollReport);
      root.removeEventListener('dblclick', onDoubleClick);
      root.removeEventListener('click', onLinkClick);
    },
  };
}
