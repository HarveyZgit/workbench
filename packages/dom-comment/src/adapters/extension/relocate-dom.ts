import { foldWhitespace, pickCandidate } from '../../core/anchor.js';
import {
  threadNumber,
  type RelocateCandidate,
  type StoredAnchor,
  type StoredTabFile,
} from '../../core/types.js';

function candidateFromEl(el: Element, extra: Partial<RelocateCandidate>): RelocateCandidate {
  const text = foldWhitespace((el as HTMLElement).innerText || el.textContent || '');
  return {
    cssMatched: false,
    xpathMatched: false,
    idMatched: false,
    testIdMatched: false,
    rectMatched: false,
    tagName: el.tagName.toLowerCase(),
    text,
    before: '',
    after: '',
    ...extra,
  };
}

function docRectToView(rect: { x: number; y: number; width: number; height: number }): DOMRect {
  return new DOMRect(rect.x - window.scrollX, rect.y - window.scrollY, rect.width, rect.height);
}

export function locateAnchor(anchor: StoredAnchor): { el?: Element; rect: DOMRect } | null {
  if (anchor.kind === 'area') {
    return { rect: docRectToView(anchor.rect) };
  }
  const cs: RelocateCandidate[] = [];
  const els: Element[] = [];
  try {
    const found = [...document.querySelectorAll(anchor.css)];
    for (const el of found) {
      els.push(el);
      cs.push(candidateFromEl(el, { cssMatched: true }));
    }
  } catch {
    // bad selector
  }
  if (cs.length === 0 && anchor.id) {
    const el = document.getElementById(anchor.id);
    if (el) {
      els.push(el);
      cs.push(candidateFromEl(el, { idMatched: true }));
    }
  }
  const idx = pickCandidate(anchor, cs);
  if (idx === null || !els[idx]) {
    if (anchor.kind === 'text') {
      return { rect: docRectToView(anchor.rect) };
    }
    return null;
  }
  return { el: els[idx], rect: els[idx].getBoundingClientRect() };
}

export function pinModels(
  tab: StoredTabFile,
  url: string,
): { x: number; y: number; w: number; h: number; area: boolean; id: string; number: number }[] {
  const page = tab.pages[url];
  if (!page) {
    return [];
  }
  const pins = [];
  let i = 0;
  for (const thread of page.threads) {
    if (thread.status !== 'open') {
      continue;
    }
    const hit = locateAnchor(thread.anchor);
    if (!hit) {
      continue;
    }
    i += 1;
    pins.push({
      x: hit.rect.left,
      y: hit.rect.top,
      w: hit.rect.width,
      h: hit.rect.height,
      area: thread.anchor.kind === 'area',
      id: thread.id,
      number: threadNumber(thread, i),
    });
  }
  return pins;
}
