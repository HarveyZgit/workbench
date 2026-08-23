import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeUrl } from '../src/core/identity.js';

test('strips tracking query and non-router hash', () => {
  assert.equal(canonicalizeUrl('https://ex.com/app/?utm_source=x&id=1#section'), 'https://ex.com/app?id=1');
});

test('keeps HashRouter and origin slash', () => {
  assert.equal(canonicalizeUrl('https://ex.com/#/home'), 'https://ex.com/#/home');
  assert.equal(canonicalizeUrl('HTTPS://Ex.COM/'), 'https://ex.com/');
});

test('strips trailing slash on non-root path', () => {
  assert.equal(canonicalizeUrl('https://ex.com/app/'), 'https://ex.com/app');
});

test('rejects non-http', () => {
  assert.throws(() => canonicalizeUrl('file:///tmp/x'), /unsupported URL scheme/);
});
