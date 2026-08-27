import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeUrl, isAnnotatableUrl, isHttpUrl } from '../src/core/identity.js';

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

test('accepts file URLs and rejects other schemes', () => {
  assert.equal(canonicalizeUrl('file:///tmp/x'), 'file:///tmp/x');
  assert.equal(canonicalizeUrl('file:///tmp/x#section'), 'file:///tmp/x');
  assert.equal(canonicalizeUrl('file:///tmp/dir/'), 'file:///tmp/dir/');
  assert.throws(() => canonicalizeUrl('ftp://example.com/x'), /unsupported URL scheme/);
  assert.throws(() => canonicalizeUrl('chrome://extensions'), /unsupported URL scheme/);
});

test('isAnnotatableUrl allows http https file', () => {
  assert.equal(isAnnotatableUrl('https://ex.com/'), true);
  assert.equal(isAnnotatableUrl('http://ex.com/'), true);
  assert.equal(isAnnotatableUrl('file:///tmp/x'), true);
  assert.equal(isAnnotatableUrl('ftp://example.com/x'), false);
  assert.equal(isAnnotatableUrl('chrome://extensions'), false);
  assert.equal(isAnnotatableUrl('not a url'), false);
  assert.equal(isHttpUrl('file:///tmp/x'), false);
  assert.equal(isHttpUrl('https://ex.com/'), true);
});
