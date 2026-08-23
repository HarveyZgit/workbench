const OVERLAY_NAME = 'DOM-COMMENT-OVERLAY';
const UI_NAME = 'DOM-COMMENT-UI';
const QUEUE_NAME = 'DOM-COMMENT-QUEUE';
const BLUE = '#1A6B54';

function numberPin(id: string, n: number, left: number, top: number, interactive: boolean): string {
  const pe = interactive ? 'auto' : 'none';
  const pin = interactive ? `data-pin="${id}"` : '';
  return `<div ${pin} style="position:fixed;left:${left}px;top:${top}px;width:22px;height:22px;border-radius:50%;background:${BLUE};color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center;pointer-events:${pe};cursor:${interactive ? 'pointer' : 'default'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.28);box-sizing:border-box">${n}</div>`;
}

export function isOurHost(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) {
    return false;
  }
  const root = el.getRootNode();
  if (root instanceof ShadowRoot && root.host) {
    const tag = root.host.tagName;
    return tag === OVERLAY_NAME || tag === UI_NAME || tag === QUEUE_NAME;
  }
  return (
    el.closest(OVERLAY_NAME.toLowerCase()) !== null ||
    el.closest(UI_NAME.toLowerCase()) !== null ||
    el.closest(QUEUE_NAME.toLowerCase()) !== null
  );
}

export function skipTarget(el: Element | null): boolean {
  if (!el || el === document.documentElement || el === document.body) {
    return true;
  }
  if (el.tagName === OVERLAY_NAME || el.tagName === UI_NAME || el.tagName === QUEUE_NAME) {
    return true;
  }
  return isOurHost(el);
}

export function deepestElement(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!skipTarget(el)) {
      return el;
    }
  }
  return null;
}

let pinClick: ((id: string) => void) | undefined;

export function setPinClickHandler(fn: (id: string) => void): void {
  pinClick = fn;
}

export function ensureOverlayHost(): HTMLElement {
  let host = document.querySelector(OVERLAY_NAME.toLowerCase()) as HTMLElement | null;
  if (!host) {
    host = document.createElement(OVERLAY_NAME.toLowerCase());
    host.style.all = 'unset';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';
    document.documentElement.append(host);
  }
  if (!host.shadowRoot) {
    const root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', (ev) => {
      const node = ev.target as HTMLElement | null;
      const pin = node?.closest?.('[data-pin]');
      if (pin) {
        ev.preventDefault();
        ev.stopPropagation();
        const id = pin.getAttribute('data-pin');
        if (id) {
          pinClick?.(id);
        }
      }
    });
  }
  return host;
}

export function renderOverlay(opts: {
  banner: boolean;
  hover: DOMRect | null;
  rubber: { x: number; y: number; w: number; h: number } | null;
  pins: { x: number; y: number; w: number; h: number; area: boolean; id: string; number: number }[];
  draft?: { x: number; y: number; w: number; h: number; number?: number } | null;
}): void {
  const host = ensureOverlayHost();
  const root = host.shadowRoot!;
  const hover = opts.hover
    ? `<div style="position:fixed;left:${opts.hover.left}px;top:${opts.hover.top}px;width:${opts.hover.width}px;height:${opts.hover.height}px;border:2px solid ${BLUE};pointer-events:none;box-sizing:border-box;"></div>`
    : '';
  const rubber = opts.rubber
    ? `<div style="position:fixed;left:${opts.rubber.x}px;top:${opts.rubber.y}px;width:${opts.rubber.w}px;height:${opts.rubber.h}px;border:2px dashed ${BLUE};background:rgba(37,99,235,.08);pointer-events:none;box-sizing:border-box;"></div>`
    : '';
  const banner = opts.banner
    ? `<div style="position:fixed;left:50%;top:12px;transform:translateX(-50%);background:${BLUE};color:#fff;font:13px/1.4 system-ui,sans-serif;padding:6px 12px;border-radius:999px;pointer-events:none;">标注中 · Esc 退出 · 长按空格看原页面</div>`
    : '';
  const pins = opts.pins
    .map((p) => {
      const bx = Math.min(window.innerWidth - 26, Math.max(4, p.x + p.w - 10));
      const by = Math.max(4, p.y - 8);
      const mark = numberPin(p.id, p.number, bx, by, true);
      if (p.area) {
        return `<div data-pin="${p.id}" style="position:fixed;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;border:2px solid ${BLUE};background:rgba(37,99,235,.08);pointer-events:auto;cursor:pointer;box-sizing:border-box;"></div>${mark}`;
      }
      return mark;
    })
    .join('');
  const draft = opts.draft
    ? numberPin(
        'draft',
        opts.draft.number || 0,
        Math.min(window.innerWidth - 26, Math.max(4, opts.draft.x + opts.draft.w - 10)),
        Math.max(4, opts.draft.y - 8),
        false,
      )
    : '';
  root.innerHTML = `${banner}${hover}${rubber}${pins}${draft}`;
}

export function removeOverlay(): void {
  document.querySelector(OVERLAY_NAME.toLowerCase())?.remove();
}

export function setOverlayHidden(hidden: boolean): void {
  const host = document.querySelector(OVERLAY_NAME.toLowerCase()) as HTMLElement | null;
  if (host) {
    host.style.visibility = hidden ? 'hidden' : 'visible';
  }
}
