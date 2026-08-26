import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findHeadingLine, headingSlug, headingTextFromInline } from '../src/preview/heading.ts';

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
