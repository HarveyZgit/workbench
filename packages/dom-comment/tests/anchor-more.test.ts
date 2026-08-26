import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAnchor, clip, pickCandidate, quoteStrength, scoreCandidate } from '../src/core/anchor.js';
import { canonicalizeUrl, isHttpUrl } from '../src/core/identity.js';
import type { RelocateCandidate, StoredElementAnchor } from '../src/core/types.js';

const CLIP_SHORT = 10;
const CLIP_LONG = 20;
const CLIP_LIMIT = 5;
const CONTEXT_PAD = 80;
const HTTP_PORT = 80;
const HTTPS_PORT = 443;

const base: StoredElementAnchor = {
  kind: 'element',
  css: 'button.save',
  xpath: '/html/body/button',
  tagName: 'button',
  quote: '',
  before: '',
  after: '',
  snapshot: { pageTitle: 'x', outerHTML: '', textContent: '' },
};

function cand(over: Partial<RelocateCandidate> = {}): RelocateCandidate {
  return {
    cssMatched: false,
    xpathMatched: false,
    idMatched: false,
    testIdMatched: false,
    rectMatched: false,
    tagName: 'div',
    text: '其他',
    before: '',
    after: '',
    ...over,
  };
}

test('clip and buildAnchor area/text', () => {
  assert.equal(clip('short', CLIP_SHORT), 'short');
  assert.ok(clip('x'.repeat(CLIP_LONG), CLIP_LIMIT).endsWith('…'));
  const area = buildAnchor(
    {
      kind: 'area',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      quote: '  hello   world  ',
      before: 'b'.repeat(CONTEXT_PAD),
      after: 'a'.repeat(CONTEXT_PAD),
      outerHTML: '<div></div>',
      textContent: 'hello world',
    },
    'Title',
  );
  assert.equal(area.kind, 'area');
  const text = buildAnchor(
    {
      kind: 'text',
      css: 'p',
      xpath: '//p',
      tagName: 'p',
      quote: 'hi',
      before: '',
      after: '',
      startOffset: 0,
      endOffset: 2,
      outerHTML: '<p>hi</p>',
      textContent: 'hi',
      rect: { x: 0, y: 0, width: 1, height: 1 },
    },
    'T',
  );
  assert.equal(text.kind, 'text');
});

test('pickCandidate empty quote uses unique css or id', () => {
  assert.equal(pickCandidate(base, []), null);
  assert.equal(pickCandidate(base, [cand({ cssMatched: true }), cand()]), 0);
  assert.equal(pickCandidate(base, [cand({ idMatched: true }), cand()]), 0);
  const weak = { ...base, quote: '保存' };
  assert.equal(quoteStrength(weak, cand({ text: '请保存更改' })), 'weak');
  assert.ok(
    scoreCandidate(weak, cand({ text: '请保存更改', after: 'x', xpathMatched: true, testIdMatched: true })) >=
      0,
  );
});

test('canonicalizeUrl strips default ports and isHttpUrl', () => {
  assert.equal(canonicalizeUrl(`http://Ex.COM:${HTTP_PORT}/a/`), 'http://ex.com/a');
  assert.equal(canonicalizeUrl(`https://ex.com:${HTTPS_PORT}/a`), 'https://ex.com/a');
  assert.equal(isHttpUrl('not a url'), false);
  assert.equal(isHttpUrl('ftp://x'), false);
});
