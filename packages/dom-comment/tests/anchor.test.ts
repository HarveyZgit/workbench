import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickCandidate, scoreCandidate, foldWhitespace } from '../src/core/anchor.js';
import { RELOCATE_THRESHOLD, type RelocateCandidate, type StoredElementAnchor } from '../src/core/types.js';

const baseAnchor: StoredElementAnchor = {
  kind: 'element',
  css: 'button.save',
  xpath: '/html/body/button',
  tagName: 'button',
  quote: '保存更改',
  before: '表单',
  after: '取消',
  snapshot: { pageTitle: 'x', outerHTML: '', textContent: '保存更改' },
};

function cand(over: Partial<RelocateCandidate> = {}): RelocateCandidate {
  return {
    cssMatched: false,
    xpathMatched: false,
    idMatched: false,
    testIdMatched: false,
    rectMatched: false,
    tagName: 'button',
    text: '保存更改',
    before: '表单',
    after: '取消',
    ...over,
  };
}

test('foldWhitespace collapses inner space', () => {
  assert.equal(foldWhitespace('  a \n b  '), 'a b');
});

test('strong+both scores one million', () => {
  const strongBothPlusCssPlusTag = 1_000_101;
  assert.equal(scoreCandidate(baseAnchor, cand({ cssMatched: true })), strongBothPlusCssPlusTag);
});

test('unique css+strong is accepted immediately', () => {
  const i = pickCandidate(baseAnchor, [cand({ cssMatched: true }), cand({ text: '其他' })]);
  assert.equal(i, 0);
});

test('tag-only is below threshold', () => {
  const a = { ...baseAnchor, quote: 'nope', before: '', after: '' };
  const i = pickCandidate(a, [cand({ text: '保存更改', before: '', after: '' })]);
  assert.equal(i, null);
  assert.ok(scoreCandidate(a, cand({ text: '保存更改', before: '', after: '' })) < RELOCATE_THRESHOLD);
});

test('text css+strong accepted like element', () => {
  const text = {
    kind: 'text' as const,
    css: 'p.lead',
    xpath: '/html/body/p',
    tagName: 'p',
    quote: '保存更改后应当出现成功状态',
    before: '',
    after: '',
    startOffset: 0,
    endOffset: 12,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    snapshot: { pageTitle: '', outerHTML: '', textContent: '保存更改后应当出现成功状态' },
  };
  const i = pickCandidate(text, [
    cand({ cssMatched: true, tagName: 'p', text: '保存更改后应当出现成功状态', before: '', after: '' }),
  ]);
  assert.equal(i, 0);
});

test('area rectMatched+strong accepted', () => {
  const area = {
    kind: 'area' as const,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    quote: '侧栏导航',
    before: '',
    after: '',
    snapshot: { pageTitle: '', outerHTML: '', textContent: '侧栏导航' },
  };
  const i = pickCandidate(area, [
    cand({ rectMatched: true, tagName: '', text: '侧栏导航', before: '', after: '' }),
  ]);
  assert.equal(i, 0);
});
