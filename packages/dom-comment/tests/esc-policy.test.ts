import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveEscapeAction } from '../src/adapters/extension/esc-policy.js';

describe('esc-policy', () => {
  it('composer wins over drawer when both are open', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: true, drawerOpen: true, dragging: false, modeOn: true }),
      'composer',
    );
  });

  it('closes drawer when composer is closed', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: false, drawerOpen: true, dragging: false, modeOn: true }),
      'drawer',
    );
  });

  it('cancels rubber-band before exiting mode', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: false, drawerOpen: false, dragging: true, modeOn: true }),
      'rubber',
    );
  });

  it('exits mode when only annotate is on', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: false, drawerOpen: false, dragging: false, modeOn: true }),
      'mode',
    );
  });

  it('no-op when nothing is open', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: false, drawerOpen: false, dragging: false, modeOn: false }),
      null,
    );
  });

  it('composer closes even with empty composer after outside-click leave-open', () => {
    assert.equal(
      resolveEscapeAction({ composerOpen: true, drawerOpen: false, dragging: false, modeOn: true }),
      'composer',
    );
  });
});
