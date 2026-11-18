const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const MIN_PREVIEW = 360;
const OUTLINE_WIDTH = 220;
const KEY_STEP = 24;

export function installSidebarResize(
  appElement: HTMLElement | null,
  separatorElement: HTMLElement | null,
  initialWidth: number | undefined,
  persist: (width: number) => void,
): () => void {
  if (!appElement || !separatorElement) {
    return () => {
      // Synthetic or older webview templates can omit the separator.
    };
  }
  const app = appElement;
  const separator = separatorElement;
  let preferred =
    typeof initialWidth === 'number' && Number.isFinite(initialWidth) ? initialWidth : MIN_WIDTH;
  let current = MIN_WIDTH;
  let drag: { id: number; x: number; width: number; preferred: number } | undefined;

  function limit(): number {
    const outline = app.classList.contains('outline-collapsed') ? 0 : OUTLINE_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, app.clientWidth - outline - MIN_PREVIEW));
  }

  function update(next = preferred): void {
    const maximum = limit();
    current = Math.min(maximum, Math.max(MIN_WIDTH, Math.round(next)));
    app.style.setProperty('--mdc-sidebar-width', `${current}px`);
    separator.setAttribute('aria-valuemax', String(maximum));
    separator.setAttribute('aria-valuenow', String(current));
    separator.setAttribute('aria-valuetext', `${current} 像素`);
  }

  separator.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) {
      return;
    }
    event.preventDefault();
    separator.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, width: current, preferred };
    app.classList.add('sidebar-resizing');
    separator.setPointerCapture(event.pointerId);
  });
  separator.addEventListener('pointermove', (event) => {
    if (drag?.id === event.pointerId) {
      update(drag.width + drag.x - event.clientX);
    }
  });
  function finish(event: PointerEvent, canceled: boolean): void {
    if (drag?.id !== event.pointerId) {
      return;
    }
    const old = drag;
    drag = undefined;
    app.classList.remove('sidebar-resizing');
    if (!canceled && current !== old.width) {
      preferred = current;
      persist(preferred);
    } else {
      ({ preferred } = old);
    }
    update();
  }
  separator.addEventListener('pointerup', (event) => finish(event, false));
  separator.addEventListener('pointercancel', (event) => finish(event, true));
  separator.addEventListener('lostpointercapture', (event) => finish(event, true));
  separator.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    const next =
      event.key === 'ArrowLeft'
        ? current + KEY_STEP
        : event.key === 'ArrowRight'
          ? current - KEY_STEP
          : event.key === 'Home'
            ? MIN_WIDTH
            : event.key === 'End'
              ? limit()
              : undefined;
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const old = current;
    update(next);
    if (old !== current) {
      preferred = current;
      persist(preferred);
    }
  });
  window.addEventListener('resize', () => update());
  update();
  return update;
}
