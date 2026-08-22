import {
  CONTEXT_LEN,
  QUOTE_MAX,
  SNAPSHOT_TEXT_MAX,
  type CapturedArea,
  type CapturedElement,
} from '../../core/types.js';
import { foldWhitespace } from '../../core/anchor.js';
import { skipTarget } from './highlight.js';

const HASHED = /^(css-|sc-|_[a-zA-Z0-9]{5,}|[a-z]+-[a-z0-9]{6,})$/;
const BAD_ID = /^(ember\d+$|react-aria-|radix-)/;

function cap(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function visibleText(el: Element): string {
  return foldWhitespace((el as HTMLElement).innerText || el.textContent || '');
}

export function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id) && !BAD_ID.test(el.id)) {
    const sel = `#${CSS.escape(el.id)}`;
    if (document.querySelectorAll(sel).length === 1) {
      return sel;
    }
  }
  const testId =
    (el as HTMLElement).dataset.testid || (el as HTMLElement).dataset.test || (el as HTMLElement).dataset.qa;
  if (testId) {
    const sel = `[data-testid="${CSS.escape(testId)}"]`;
    if (document.querySelectorAll(sel).length === 1) {
      return sel;
    }
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  const maxParts = 8;
  while (cur && cur !== document.documentElement && parts.length < maxParts) {
    const tag = cur.tagName.toLowerCase();
    let part = tag;
    const cls = [...cur.classList].filter((c) => c.includes('__') && !HASHED.test(c))[0];
    if (cls) {
      part += `.${CSS.escape(cls)}`;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) {
        part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    if (document.querySelectorAll(parts.join(' > ')).length === 1) {
      break;
    }
    cur = parent;
  }
  return parts.join(' > ');
}

export function xpathOf(el: Element): string {
  if (el.id) {
    return `//*[@id="${el.id}"]`;
  }
  const segs: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) {
      segs.unshift(tag);
      break;
    }
    const same = [...parentEl.children].filter((c) => c.tagName === cur!.tagName);
    const idx = same.indexOf(cur) + 1;
    segs.unshift(`${tag}[${idx}]`);
    cur = parentEl;
  }
  return `/${segs.join('/')}`;
}

export function captureElement(el: Element): CapturedElement {
  const text = visibleText(el);
  return {
    kind: 'element',
    css: cssPath(el),
    xpath: xpathOf(el),
    tagName: el.tagName.toLowerCase(),
    id: el.id || undefined,
    hints: {
      testId: (el as HTMLElement).dataset.testid,
      ariaLabel: el.getAttribute('aria-label') || undefined,
    },
    quote: cap(text, QUOTE_MAX),
    before: '',
    after: '',
    outerHTML: cap(el.outerHTML, 2048),
    textContent: cap(text, SNAPSHOT_TEXT_MAX),
  };
}

function textInRect(rect: DOMRect): { quote: string; before: string; after: string } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const inside: string[] = [];
  let before = '';
  let after = '';
  let seen = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || skipTarget(parent)) {
      continue;
    }
    const r = parent.getBoundingClientRect();
    const hit = r.right >= rect.left && r.left <= rect.right && r.bottom >= rect.top && r.top <= rect.bottom;
    const t = foldWhitespace(node.textContent || '');
    if (!t) {
      continue;
    }
    if (hit) {
      inside.push(t);
      seen = true;
    } else if (!seen) {
      before = t;
    } else if (!after) {
      after = t;
    }
  }
  return {
    quote: cap(foldWhitespace(inside.join(' ')), QUOTE_MAX),
    before: before.slice(-CONTEXT_LEN),
    after: after.slice(0, CONTEXT_LEN),
  };
}

export function captureArea(client: { x: number; y: number; w: number; h: number }): CapturedArea {
  const rect = new DOMRect(client.x, client.y, client.w, client.h);
  const texts = textInRect(rect);
  const cx = client.x + client.w / 2;
  const cy = client.y + client.h / 2;
  const mid = document.elementFromPoint(cx, cy);
  const outer = mid && !skipTarget(mid) ? cap(mid.outerHTML, 2048) : '';
  return {
    kind: 'area',
    rect: {
      x: client.x + window.scrollX,
      y: client.y + window.scrollY,
      width: client.w,
      height: client.h,
    },
    quote: texts.quote,
    before: texts.before,
    after: texts.after,
    outerHTML: outer,
    textContent: cap(texts.quote, SNAPSHOT_TEXT_MAX),
  };
}
