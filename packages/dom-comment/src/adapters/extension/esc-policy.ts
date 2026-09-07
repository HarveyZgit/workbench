/**
 * Escape key priority for the content-script overlay.
 * Composer closes before the drawer when both are open.
 */
export type EscapeAction = 'composer' | 'drawer' | 'rubber' | 'mode' | null;

export function resolveEscapeAction(opts: {
  composerOpen: boolean;
  drawerOpen: boolean;
  dragging: boolean;
  modeOn: boolean;
}): EscapeAction {
  if (opts.composerOpen) {
    return 'composer';
  }
  if (opts.drawerOpen) {
    return 'drawer';
  }
  if (opts.dragging) {
    return 'rubber';
  }
  if (opts.modeOn) {
    return 'mode';
  }
  return null;
}
