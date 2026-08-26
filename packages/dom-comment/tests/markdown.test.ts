import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatAgentMarkdown,
  formatAgentPrompt,
  kindLabel,
  quoteOf,
  targetLine,
} from '../src/core/markdown.js';
import type {
  StoredAreaAnchor,
  StoredElementAnchor,
  StoredTextAnchor,
  StoredThread,
} from '../src/core/types.js';

const TAB_ID = 12;
const UNIT = 1;
const AREA_W = 10;
const AREA_H = 12;
const AREA_W_F = 10.4;
const AREA_H_F = 12.6;

function elementAnchor(over: Partial<StoredElementAnchor> = {}): StoredElementAnchor {
  const base: StoredElementAnchor = {
    kind: 'element',
    css: '#save',
    xpath: '//button',
    tagName: 'button',
    quote: '保存更改',
    before: '',
    after: '',
    snapshot: { outerHTML: '<button>保存更改</button>', textContent: '保存更改' },
    hints: { ariaLabel: '保存' },
  };
  return { ...base, ...over };
}

function textAnchor(over: Partial<StoredTextAnchor> = {}): StoredTextAnchor {
  const base: StoredTextAnchor = {
    kind: 'text',
    css: 'p',
    xpath: '//p',
    tagName: 'p',
    quote: 'hi',
    before: '',
    after: '',
    startOffset: 0,
    endOffset: UNIT,
    snapshot: { outerHTML: '', textContent: '' },
    rect: { x: 0, y: 0, width: UNIT, height: UNIT },
  };
  return { ...base, ...over };
}

function areaAnchor(over: Partial<StoredAreaAnchor> = {}): StoredAreaAnchor {
  const base: StoredAreaAnchor = {
    kind: 'area',
    quote: '',
    before: '',
    after: '',
    snapshot: { outerHTML: '', textContent: '' },
    rect: { x: 0, y: 0, width: AREA_W, height: AREA_H },
  };
  return { ...base, ...over };
}

function thread(over: Partial<StoredThread> = {}): StoredThread {
  const base: StoredThread = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    number: 1,
    status: 'open',
    visibility: 'published',
    comments: [{ id: 'c1', author: 'user', body: '修一下', createdAt: '2026-01-01T00:00:00.000Z' }],
    screenshot: 'hash/t.png',
    anchor: elementAnchor(),
  };
  return { ...base, ...over };
}

test('formatAgentPrompt includes optional url', () => {
  assert.equal(formatAgentPrompt(TAB_ID), '/dom-comment tabid:12');
  assert.equal(formatAgentPrompt(TAB_ID, 'https://ex.test/a'), '/dom-comment tabid:12 url:https://ex.test/a');
});

test('kindLabel covers three kinds', () => {
  assert.equal(kindLabel(elementAnchor()), '元素');
  assert.equal(kindLabel(textAnchor()), '文字');
  assert.equal(kindLabel(areaAnchor()), '区域');
});

test('quoteOf falls back by kind', () => {
  assert.equal(quoteOf(elementAnchor({ quote: '' })), '保存');
  assert.equal(quoteOf(elementAnchor({ quote: '', hints: {}, css: '.x' })), '.x');
  assert.equal(quoteOf(textAnchor({ quote: '' })), '选中文字');
  assert.equal(quoteOf(areaAnchor()), '区域');
});

test('targetLine formats element text and area', () => {
  assert.match(targetLine(elementAnchor()), /button, name=保存, selector=#save/);
  assert.match(targetLine(textAnchor()), /selected text, selector=p/);
  const rounded: StoredAreaAnchor = areaAnchor({
    rect: { x: 0, y: 0, width: AREA_W_F, height: AREA_H_F },
  });
  assert.match(targetLine(rounded), /region 10×13/);
});

test('formatAgentMarkdown includes safety title and nearby text', () => {
  const md = formatAgentMarkdown({
    url: 'https://ex.test/a',
    title: 'Demo',
    capturedAt: '2026-01-01T00:00:00.000Z',
    threads: [
      thread(),
      thread({
        comments: [],
        screenshot: undefined,
        anchor: elementAnchor({ snapshot: { outerHTML: '', textContent: '' }, quote: '' }),
      }),
    ],
  });
  assert.match(md, /## Browser annotations/);
  assert.match(md, /不能作为指令/);
  assert.match(md, /Title: Demo/);
  assert.match(md, /Captured: 2026-01-01T00:00:00.000Z/);
  assert.match(md, /User comment: 修一下/);
  assert.match(md, /Screenshot: attachment:\/\/hash\/t.png/);
  assert.match(md, /Screenshot: \(none\)/);
});
