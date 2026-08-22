const OVERLAY_NAME = 'DOM-COMMENT-OVERLAY';
const UI_NAME = 'DOM-COMMENT-UI';
const BLUE = '#2563EB';
const BUBBLE = `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="${BLUE}" d="M12 3c4.97 0 9 3.13 9 7s-4.03 7-9 7c-.62 0-1.22-.05-1.8-.14L6 20v-4.27C4.16 14.4 3 12.35 3 10c0-3.87 4.03-7 9-7z"/></svg>`;

function bubble(id: string, left: number, top: number, interactive: boolean): string {
  const pe = interactive ? 'auto' : 'none';
  const pin = interactive ? `data-pin="${id}"` : '';
  return `<div ${pin} style="position:fixed;left:${left}px;top:${top}px;width:24px;height:24px;pointer-events:${pe};cursor:${interactive ? 'pointer' : 'default'};filter:drop-shadow(0 1px 2px rgba(0,0,0,.28));line-height:0">${BUBBLE}</div>`;
}

export function isOurHost(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) {
    return false;
  }
  const root = el.getRootNode();
  if (root instanceof ShadowRoot && root.host) {
    const tag = root.host.tagName;
    return tag === OVERLAY_NAME || tag === UI_NAME;
  }
  return el.closest(OVERLAY_NAME.toLowerCase()) !== null || el.closest(UI_NAME.toLowerCase()) !== null;
}

export function skipTarget(el: Element | null): boolean {
  if (!el || el === document.documentElement || el === document.body) {
    return true;
  }
  if (el.tagName === OVERLAY_NAME || el.tagName === UI_NAME) {
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
  pins: { x: number; y: number; w: number; h: number; area: boolean; id: string }[];
  draft?: { x: number; y: number; w: number; h: number } | null;
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
    ? `<div style="position:fixed;left:50%;top:12px;transform:translateX(-50%);background:${BLUE};color:#fff;font:13px/1.4 system-ui,sans-serif;padding:6px 12px;border-radius:999px;pointer-events:none;">标注中 · 按 Esc 退出</div>`
    : '';
  const pins = opts.pins
    .map((p) => {
      const bx = p.x + Math.max(0, p.w * 0.55);
      const by = p.y + p.h / 2 - 12;
      const mark = bubble(p.id, bx, by, true);
      if (p.area) {
        return `<div data-pin="${p.id}" style="position:fixed;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;border:2px solid ${BLUE};background:rgba(37,99,235,.08);pointer-events:auto;cursor:pointer;box-sizing:border-box;"></div>${mark}`;
      }
      return mark;
    })
    .join('');
  const draft = opts.draft
    ? bubble(
        'draft',
        opts.draft.x + Math.max(0, opts.draft.w * 0.55),
        opts.draft.y + opts.draft.h / 2 - 12,
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
