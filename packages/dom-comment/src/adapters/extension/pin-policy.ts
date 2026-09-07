/**
 * Pin / browse interaction policy for the content-script overlay.
 *
 * - Annotate mode: numbered pins reopen existing threads for edit; page clicks still create.
 * - Browse (mode off): pins only when the float drawer is open; pin/card opens edit + highlight.
 * - Drawer cards stay create-only (select disabled) while annotate + drawer open.
 */

export function pinsShouldBeInteractive(opts: {
  modeOn: boolean;
  peeking: boolean;
  drawerOpen: boolean;
}): boolean {
  if (opts.peeking) {
    return false;
  }
  if (opts.modeOn) {
    return true;
  }
  return opts.drawerOpen;
}

/** Area fill hit-targets only in browse (so annotate clicks can still create on the region). */
export function areaPinsShouldBeInteractive(opts: {
  modeOn: boolean;
  peeking: boolean;
  drawerOpen: boolean;
}): boolean {
  if (opts.peeking || opts.modeOn) {
    return false;
  }
  return opts.drawerOpen;
}

/** Whether a pin click should open the thread panel for view/edit. */
export function canOpenPinForEdit(modeOn: boolean, drawerOpen: boolean): boolean {
  return modeOn || drawerOpen;
}
