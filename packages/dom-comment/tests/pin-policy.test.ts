import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  areaPinsShouldBeInteractive,
  canOpenPinForEdit,
  pinsShouldBeInteractive,
} from '../src/adapters/extension/pin-policy.js';

describe('pin-policy', () => {
  it('annotate mode: number pins interactive for reopen/edit; area fills not', () => {
    const opts = { modeOn: true, peeking: false, drawerOpen: false };
    assert.equal(pinsShouldBeInteractive(opts), true);
    assert.equal(areaPinsShouldBeInteractive(opts), false);
    assert.equal(canOpenPinForEdit(true, false), true);
  });

  it('annotate + drawer open: pins still reopen; area fills still not (create-through)', () => {
    const opts = { modeOn: true, peeking: false, drawerOpen: true };
    assert.equal(pinsShouldBeInteractive(opts), true);
    assert.equal(areaPinsShouldBeInteractive(opts), false);
    assert.equal(canOpenPinForEdit(true, true), true);
  });

  it('browse with drawer open: pins and area fills interactive', () => {
    const opts = { modeOn: false, peeking: false, drawerOpen: true };
    assert.equal(pinsShouldBeInteractive(opts), true);
    assert.equal(areaPinsShouldBeInteractive(opts), true);
    assert.equal(canOpenPinForEdit(false, true), true);
  });

  it('browse with drawer closed: no pin interaction', () => {
    const opts = { modeOn: false, peeking: false, drawerOpen: false };
    assert.equal(pinsShouldBeInteractive(opts), false);
    assert.equal(areaPinsShouldBeInteractive(opts), false);
    assert.equal(canOpenPinForEdit(false, false), false);
  });

  it('peeking disables pin interaction', () => {
    assert.equal(pinsShouldBeInteractive({ modeOn: true, peeking: true, drawerOpen: true }), false);
    assert.equal(areaPinsShouldBeInteractive({ modeOn: false, peeking: true, drawerOpen: true }), false);
  });
});
