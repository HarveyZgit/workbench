import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildHeadingTree,
  findHeadingLine,
  headingSlug,
  headingTextFromInline,
} from '../src/preview/heading.ts';

test('headingSlug strips tags and punctuation', () => {
  assert.equal(headingSlug('  Hello, World!  '), 'hello-world');
  assert.equal(headingSlug('<em>Foo</em> Bar'), 'foo-bar');
});

test('headingTextFromInline walks text code and image children', () => {
  assert.equal(headingTextFromInline({ content: 'plain', children: null } as never), 'plain');
  assert.equal(
    headingTextFromInline({
      content: '',
      children: [
        { type: 'text', content: 'A' },
        { type: 'code_inline', content: 'B' },
        { type: 'image', content: 'alt' },
        { type: 'strong', content: 'x' },
      ],
    } as never),
    'ABalt',
  );
});

test('findHeadingLine matches slugs including duplicates', () => {
  const src = '# Intro\n\ntext\n\n# Intro\n';
  assert.equal(findHeadingLine(src, 'intro'), 0);
  assert.equal(findHeadingLine(src, 'intro-1'), 4);
  assert.equal(findHeadingLine(src, 'missing'), null);
});

test('buildHeadingTree nests by heading level', () => {
  const tree = buildHeadingTree(`# A

## B

### C

## D

# E
`);
  assert.equal(tree.length, 2);
  assert.deepEqual(
    tree.map((n) => ({ id: n.id, level: n.level, kids: n.children.map((c) => c.id) })),
    [
      { id: 'a', level: 1, kids: ['b', 'd'] },
      { id: 'e', level: 1, kids: [] },
    ],
  );
  assert.equal(tree[0].children[0].children[0].id, 'c');
  assert.equal(tree[0].children[0].children[0].text, 'C');
  assert.equal(tree[0].children[0].line, 2);
});

test('buildHeadingTree handles skipped levels and duplicate titles', () => {
  const tree = buildHeadingTree(`# Root

### Deep

# Root
`);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, 'root');
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'deep');
  assert.equal(tree[0].children[0].level, 3);
  assert.equal(tree[1].id, 'root-1');
  assert.equal(tree[1].children.length, 0);
});

test('buildHeadingTree returns empty for no headings', () => {
  assert.deepEqual(buildHeadingTree('plain paragraph\n\n- list\n'), []);
});
