import { foldWhitespace, pickCandidate } from '../../core/anchor.js';
import type { RelocateCandidate, StoredAnchor, StoredTabFile } from '../../core/types.js';

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

export function locateAnchor(anchor: StoredAnchor): { el?: Element; rect: DOMRect } | null {
  const cs: RelocateCandidate[] = [];
  const els: Element[] = [];
  if (anchor.kind === 'element') {
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
  } else {
    return {
      rect: new DOMRect(
        anchor.rect.x - window.scrollX,
        anchor.rect.y - window.scrollY,
        anchor.rect.width,
        anchor.rect.height,
      ),
    };
  }
  const idx = pickCandidate(anchor, cs);
  if (idx === null || !els[idx]) {
    return null;
  }
  return { el: els[idx], rect: els[idx].getBoundingClientRect() };
}

export function pinModels(
  tab: StoredTabFile,
  url: string,
): { x: number; y: number; w: number; h: number; area: boolean; id: string }[] {
  const page = tab.pages[url];
  if (!page) {
    return [];
  }
  const pins = [];
  for (const thread of page.threads) {
    if (thread.status !== 'open') {
      continue;
    }
    const hit = locateAnchor(thread.anchor);
    if (!hit) {
      continue;
    }
    pins.push({
      x: hit.rect.left,
      y: hit.rect.top,
      w: hit.rect.width,
      h: hit.rect.height,
      area: thread.anchor.kind === 'area',
      id: thread.id,
    });
  }
  return pins;
}
