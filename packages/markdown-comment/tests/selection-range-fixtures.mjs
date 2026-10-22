/** Shared source/DOM fixtures for synthetic DOM and Chromium selection coverage. */
export const selectionRangeFixtures = [
  [
    'loose list',
    '- one\n\n- two\n\n- three',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    2,
    5,
    'two three',
  ],
  [
    'mixed nested list',
    '1. parent\n   - child one\n     1. deep one\n     2. deep two\n   - child two\n2. sibling',
    '#content li li li:nth-child(1)',
    '#content li li li:nth-child(2)',
    2,
    4,
    'deep one deep two',
  ],
  [
    'parent through child',
    '- parent\n  - child one\n  - child two\n- sibling',
    '#content li > span',
    '#content li li:nth-child(1)',
    0,
    2,
    'parent child one',
  ],
  [
    'cross list to paragraph',
    '- one\n- two\n\nparagraph\n\nuntouched',
    '#content li:nth-child(2)',
    '#content > p:nth-of-type(1)',
    1,
    4,
    'two paragraph',
  ],
  [
    'cross paragraph to list',
    'paragraph\n\n- one\n- two\n- untouched',
    '#content > p',
    '#content li:nth-child(2)',
    0,
    4,
    'paragraph one two',
  ],
  [
    'cross quote and list',
    '> first\n>\n> second\n\n- one\n- two',
    '#content blockquote p:nth-child(2)',
    '#content > ul > li:nth-child(1)',
    2,
    5,
    'second one',
  ],
  [
    'formatted list',
    '- untouched\n- **bold** and *italic* and [link](https://example.com)\n- `inline code`\n- untouched',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    'bold and italic and link inline code',
  ],
  [
    'multiline item',
    '- untouched\n- first line\n  continuation\n- last',
    '#content li:nth-child(2)',
    '#content li:nth-child(2)',
    1,
    3,
    'first line continuation',
  ],
  [
    'hard break',
    '- untouched\n- first  \n  second\n- last',
    '#content li:nth-child(2)',
    '#content li:nth-child(2)',
    1,
    3,
    'first second',
  ],
  [
    'unicode',
    '- 一😀\n- 二 e\u0301 中文 🚀\n- 三👩‍💻\n- 四',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    '二 e\u0301 中文 🚀 三👩‍💻',
  ],
  [
    'repeated items',
    '- repeated\n- repeated\n- repeated\n- repeated',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    'repeated repeated',
  ],
  [
    'inline image with text',
    '- untouched\n- before ![alt](./fixture.png) after\n- last',
    '#content li:nth-child(2)',
    '#content li:nth-child(2)',
    1,
    2,
    'before after',
  ],
  [
    'code block',
    'before\n\n```js\nconst x = 1;\n```\n\nafter',
    '#content pre code',
    '#content pre code',
    2,
    5,
    'const x = 1;',
  ],
  [
    'code through paragraph',
    'before\n\n```js\nconst x = 1;\n```\n\nafter\n\nuntouched',
    '#content pre code',
    '#content > p:nth-of-type(2)',
    2,
    7,
    'const x = 1; after',
  ],
  [
    'blockquote list',
    '> intro\n>\n> - one\n> - two\n> - untouched',
    '#content blockquote li:nth-child(1)',
    '#content blockquote li:nth-child(2)',
    2,
    4,
    'one two',
  ],
  [
    'definition list',
    'Term\n: first\n\nOther\n: second\n\nLast\n: untouched',
    '#content dd:nth-of-type(2)',
    '#content dd:nth-of-type(2)',
    4,
    5,
    'second',
  ],
  [
    'reverse selection',
    '- one\n- two\n- three\n- four',
    '#content li:nth-child(2)',
    '#content li:nth-child(3)',
    1,
    3,
    'two three',
    false,
    { reverse: true },
  ],
  [
    'reverse exclusive end',
    '- one\n- two\n- three\n- four',
    '#content li:nth-child(2)',
    '#content li:nth-child(4)',
    1,
    3,
    'two three',
    true,
    { reverse: true },
  ],
  [
    'element child offsets',
    '- one\n- two\n- three\n- four',
    '#content ul',
    '#content ul',
    1,
    3,
    'two three',
    false,
    { startOffset: 3, endOffset: 7 },
  ],
  [
    'repeated words',
    'same first same second same',
    '#content p',
    '#content p',
    0,
    1,
    'same',
    false,
    { textNodes: true, startOffset: 11, endOffset: 15, fallbackText: 'same first same second same' },
  ],
  [
    'unicode text offsets',
    '前缀😀后缀',
    '#content p',
    '#content p',
    0,
    1,
    '😀',
    false,
    { textNodes: true, startOffset: 2, endOffset: 4, fallbackText: '前缀😀后缀' },
  ],
  ['whole content element', 'one\n\n- two\n- three', '#content', '#content', 0, 4, 'one two three'],
];

/** Run the same refresh/navigation checks in JSDOM and real Chromium. */
export function verifyHighlightLifecycle(targetWindow) {
  const win = targetWindow ?? window;
  const doc = win.document;
  const host = (data) =>
    win.dispatchEvent(
      new win.MessageEvent('message', {
        data:
          data.type === 'render'
            ? {
                ...data,
                options: {
                  frontMatter: 'table',
                  scrollPreviewWithEditor: false,
                  scrollEditorWithPreview: false,
                  doubleClickToSwitchToEditor: false,
                  styles: [],
                  fontSize: 14,
                  lineHeight: 1.7,
                  breaks: false,
                  typographer: false,
                  html: 'safe',
                  renderedDiff: true,
                  mermaidNodeComments: false,
                },
              }
            : data,
      }),
    );
  const expect = (condition, label) => {
    if (!condition) {
      throw new Error(label);
    }
  };
  const thread = (id, overrides = {}) => ({
    id,
    kind: 'selection',
    status: 'open',
    blockStartLine: 1,
    blockEndLine: 3,
    quote: 'two\nthree',
    comments: [{ id: `${id}-comment`, author: 'user', body: 'overlap', createdAt: '2026-01-01T00:00:00Z' }],
    ...overrides,
  });
  const text = '- one\n- two\n- three\n- four';
  win.getSelection().removeAllRanges();
  doc.querySelector('[data-tab="open"]').click();
  host({ type: 'render', text, threads: [thread('a'), thread('b')] });
  const targets = () => [...doc.querySelectorAll('#content .mdc-block-hl')];
  expect(targets().length === 2, 'two fallback blocks, no ancestor widening');
  expect(
    targets().every((el) => el.dataset.threadIds === 'a,b'),
    'overlap retains both thread IDs',
  );
  for (const id of ['a', 'b']) {
    doc.querySelector(`.mdc-card[data-thread-id="${id}"]`).click();
    expect(
      doc.querySelectorAll('#content .mdc-block-hl.active').length === 2,
      `${id} sidebar navigation activates both blocks`,
    );
    targets()[0].click();
    expect(
      doc.querySelector('.mdc-card.active')?.dataset.threadId === id,
      'content click preserves selected overlap member',
    );
  }
  host({ type: 'threads', threads: [thread('a', { status: 'resolved' }), thread('b')] });
  expect(
    targets().every((el) => el.dataset.threadIds === 'b'),
    'resolved comment leaves open-filter highlights',
  );
  doc.querySelector('[data-tab="resolved"]').click();
  expect(
    targets().every((el) => el.dataset.threadIds === 'a'),
    'resolved filter restores only resolved comment',
  );
  doc.querySelector('[data-tab="all"]').click();
  expect(
    targets().every((el) => el.dataset.threadIds === 'a,b'),
    'all filter restores both',
  );
  host({ type: 'threads', threads: [thread('a')] });
  expect(
    targets().every((el) => el.dataset.threadIds === 'a'),
    'deleting overlap clears stale membership',
  );
  host({ type: 'threads', threads: [] });
  expect(
    !doc.querySelector(
      '#content .mdc-block-hl, #content mark.mdc-hl, #content [data-thread-ids], #content .active',
    ),
    'deleting final thread clears all highlight state',
  );
  host({ type: 'threads', threads: [thread('a', { orphaned: true })] });
  expect(!doc.querySelector('#content .mdc-block-hl'), 'orphaned comments never paint a stale range');

  const repeated = 'first same second same third';
  const precise = thread('precise', {
    blockStartLine: 0,
    blockEndLine: 1,
    rendered: { quote: 'same', before: 'first same second ', after: ' third' },
  });
  host({ type: 'render', text: repeated, threads: [precise] });
  const mark = doc.querySelector('#content mark');
  expect(
    mark?.textContent === 'same' && mark.previousSibling?.textContent === 'first same second ',
    'repeated quote uses rendered context, not first match',
  );
  const overlapping = thread('overlap', {
    blockStartLine: 0,
    blockEndLine: 1,
    rendered: { quote: 'second same', before: 'first same ', after: ' third' },
  });
  host({ type: 'threads', threads: [precise, overlapping] });
  for (const id of ['precise', 'overlap']) {
    doc.querySelector(`.mdc-card[data-thread-id="${id}"]`).click();
    expect(
      doc.querySelector(`#content mark[data-thread-id="${id}"].active`),
      'overlapping precise mark remains navigable',
    );
  }
  host({ type: 'threads', threads: [] });
  expect(
    doc.querySelector('#content p').textContent === repeated && !doc.querySelector('#content mark'),
    'clearing nested marks preserves text',
  );
  doc.querySelector('[data-tab="open"]').click();
  return 'overlap, resolve/reopen filters, deletion, orphaning, repeated quotes and precise nested marks';
}
