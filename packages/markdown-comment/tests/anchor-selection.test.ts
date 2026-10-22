import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import type { RenderedSelection } from '../src/preview/messages';
import type { StoredAnchor } from '../src/types';

// The adapter only needs VS Code's UTF-16 positions, ranges and document reads.
// Bundle the real implementation, not a copy of its matching algorithms.
class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}
class Range {
  start: Position;
  end: Position;
  constructor(start: Position | number, end: Position | number, endLine?: number, endChar?: number) {
    this.start = typeof start === 'number' ? new Position(start, end as number) : start;
    this.end = typeof end === 'number' ? new Position(endLine!, endChar!) : end;
  }
}
class Document {
  readonly lines: string[];
  readonly starts: number[] = [0];
  constructor(readonly text: string) {
    this.lines = text.split(/\r\n|\n|\r/);
    for (const match of text.matchAll(/\r\n|\n|\r/g)) {
      this.starts.push(match.index! + match[0].length);
    }
  }
  get lineCount() {
    return this.lines.length;
  }
  offsetAt(position: Position): number {
    if (position.line >= this.lineCount) {
      return this.text.length;
    }
    const line = Math.max(0, position.line);
    return this.starts[line] + Math.min(Math.max(0, position.character), this.lines[line].length);
  }
  positionAt(offset: number): Position {
    offset = Math.min(Math.max(0, offset), this.text.length);
    let line = this.starts.length - 1;
    while (this.starts[line] > offset) {
      line--;
    }
    return new Position(line, Math.min(offset - this.starts[line], this.lines[line].length));
  }
  getText(range?: Range) {
    return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text;
  }
  lineAt(line: number) {
    return { text: this.lines[line], range: new Range(line, 0, line, this.lines[line].length) };
  }
}
const bundled = buildSync({
  entryPoints: [new URL('../src/anchor.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
}).outputFiles[0].text;
const module: { exports: Record<string, unknown> } = { exports: {} };
new Function('require', 'module', 'exports', bundled)(
  (name: string) => {
    assert.equal(name, 'vscode');
    return { Position, Range };
  },
  module,
  module.exports,
);
const { mapRenderedSelectionToRange, buildAnchorFromRange, relocate } = module.exports as {
  mapRenderedSelectionToRange: (doc: Document, selection: RenderedSelection) => Range | null;
  buildAnchorFromRange: (doc: Document, range: Range, kind: 'selection' | 'document') => StoredAnchor;
  relocate: (doc: Document, anchor: StoredAnchor) => Range | null;
};
function persist(text: string, selection: Partial<RenderedSelection> & { quote: string }) {
  const doc = new Document(text);
  const input: RenderedSelection = {
    blockStartLine: 0,
    blockEndLine: doc.lineCount,
    before: '',
    after: '',
    spansMultipleBlocks: false,
    ...selection,
  };
  const range = mapRenderedSelectionToRange(doc, input);
  assert.ok(range);
  // Simulate the host storing source anchor plus rendered metadata and reloading JSON.
  const saved = JSON.parse(
    JSON.stringify({
      anchor: buildAnchorFromRange(doc, range, 'selection'),
      rendered: { quote: input.quote, before: input.before, after: input.after },
    }),
  ) as { anchor: StoredAnchor; rendered: { quote: string; before: string; after: string } };
  return { doc, range, ...saved };
}
function assertRelocated(text: string, anchor: StoredAnchor, start: number, quote = anchor.quote) {
  const doc = new Document(text);
  const range = relocate(doc, anchor);
  assert.ok(range, `Expected persisted ${JSON.stringify(anchor.quote)} to relocate`);
  assert.equal(doc.offsetAt(range.start), start);
  assert.equal(doc.offsetAt(range.end), start + quote.length);
  assert.equal(doc.getText(range), quote);
  return range;
}

test('persisted partial word never expands to its paragraph on unchanged reload', () => {
  const source = 'Paragraph prefix selected suffix.\n\nUnrelated next paragraph.';
  const { anchor, rendered } = persist(source, { quote: 'selected', blockEndLine: 1 });
  assert.equal(anchor.quote, 'selected');
  assert.deepEqual([anchor.startLine, anchor.startChar, anchor.endLine, anchor.endChar], [0, 17, 0, 25]);
  assert.deepEqual(rendered, { quote: 'selected', before: '', after: '' });
  assertRelocated(source, anchor, source.indexOf('selected'));
});

for (const eol of ['\n', '\r\n']) {
  test(`line-end partial selection excludes newline and next paragraph (${JSON.stringify(eol)})`, () => {
    const source = `first prefix target${eol}${eol}next block`;
    const { anchor } = persist(source, { quote: 'target', blockEndLine: 1 });
    assert.equal(anchor.quote, 'target');
    assert.equal(anchor.endLine, 0);
    assert.equal(anchor.endChar, 19);
    assertRelocated(`inserted${eol}${source}`, anchor, `inserted${eol}${source}`.indexOf('target'));
  });
}

test('UTF-16 source characters preserve CJK, surrogate pairs, combining marks and emoji sequences', () => {
  const source = '开头😀 before 👩🏽‍💻e\u0301中文 after 尾巴';
  const quote = '👩🏽‍💻e\u0301中文';
  const { anchor } = persist(source, { quote });
  assert.equal(anchor.startChar, source.indexOf(quote));
  assert.equal(anchor.endChar, source.indexOf(quote) + quote.length);
  assertRelocated(source, anchor, source.indexOf(quote));
  const edited = `新增😀\n${source}`;
  assertRelocated(edited, anchor, edited.indexOf(quote));
});

test('repeated text inside one source block is disambiguated by rendered surrounding text', () => {
  const source = 'left target one; middle target two; right target three';
  const { anchor } = persist(source, { quote: 'target', before: 'middle ', after: ' two;' });
  assert.equal(anchor.startChar, source.indexOf('target two'));
  assertRelocated(source, anchor, source.indexOf('target two'));
});

test('block bounds prevent the same quote in adjacent paragraphs from stealing the anchor', () => {
  const source = 'same target first\n\nsame target second\n\nsame target third';
  const { anchor } = persist(source, { quote: 'target', blockStartLine: 2, blockEndLine: 3 });
  assert.equal(anchor.startLine, 2);
  const edited = `introduction\n\n${source}`;
  assertRelocated(edited, anchor, edited.indexOf('target second'));
});

test('inserting and deleting preceding lines keeps the exact persisted partial selection', () => {
  const source = 'intro\n\nprefix selected suffix\n\nfooter';
  const { anchor } = persist(source, { quote: 'selected', blockStartLine: 2, blockEndLine: 3 });
  for (const edited of [`new\n${source}`, source.replace('intro\n\n', ''), `new\n\n${source}\nlast`]) {
    assertRelocated(edited, anchor, edited.indexOf('selected'));
  }
});

test('edits immediately before or after the quote retain the opposite context', () => {
  const source = 'prefix selected suffix';
  const { anchor } = persist(source, { quote: 'selected' });
  for (const edited of [
    'prefix inserted selected suffix',
    'prefix selected inserted suffix',
    'selected suffix',
    'prefix selected',
  ]) {
    assertRelocated(edited, anchor, edited.indexOf('selected'));
  }
});

test('deleted selected text is orphaned instead of highlighting a neighboring block', () => {
  const source = 'prefix selected suffix\n\nother paragraph';
  const { anchor } = persist(source, { quote: 'selected', blockEndLine: 1 });
  assert.equal(relocate(new Document(source.replace('selected', 'replacement')), anchor), null);
  assert.equal(relocate(new Document(''), anchor), null);
});

test('repeated quote inserted at old coordinates cannot override matching original context', () => {
  const source = 'original prefix target original suffix';
  const { anchor } = persist(source, { quote: 'target' });
  const edited = `different words target unrelated suffix\n${source}`;
  assertRelocated(edited, anchor, edited.lastIndexOf('target'));
});

test('Markdown source fallback preserves rendered metadata through JSON reload and relocation', () => {
  const source = 'before **bold** and [linked](https://example.com) after\n\nnext';
  const selection = { quote: 'bold and linked', before: 'before ', after: ' after', blockEndLine: 1 };
  const { anchor, rendered } = persist(source, selection);
  assert.equal(anchor.quote, source.split('\n')[0]);
  assert.deepEqual(rendered, { quote: selection.quote, before: selection.before, after: selection.after });
  const edited = `new paragraph\n\n${source}`;
  assertRelocated(edited, anchor, edited.indexOf('before'));
});

test('cross-block fallback trims trailing blank lines without including unrelated blocks', () => {
  const source = 'first part\n\nsecond part\n\nnot selected';
  const { anchor, rendered } = persist(source, {
    quote: 'part\n\nsecond',
    blockEndLine: 4,
    spansMultipleBlocks: true,
  });
  assert.equal(anchor.quote, 'first part\n\nsecond part');
  assert.deepEqual([anchor.endLine, anchor.endChar], [2, 11]);
  assert.equal(rendered.quote, 'part\n\nsecond');
  assertRelocated(source, anchor, 0);
});

test('partial selection at EOF and full document selection survive unchanged reload', () => {
  for (const quote of ['target', 'prefix target']) {
    const source = 'prefix target';
    const { anchor } = persist(source, { quote });
    assertRelocated(source, anchor, source.indexOf(quote));
    assert.deepEqual([anchor.endLine, anchor.endChar], [0, source.length]);
  }
});

test('ambiguous repeated formatted text falls back to its block without losing rendered context', () => {
  const source = 'first **same** second **same**';
  const selection = { quote: 'same', before: 'first same second ', after: '' };
  const { anchor, rendered } = persist(source, selection);
  // Raw Markdown cannot distinguish the rendered context. Keep a safe source
  // block anchor and let the separately persisted rendered context paint it.
  assert.equal(anchor.quote, source);
  assert.deepEqual(
    [anchor.startLine, anchor.startChar, anchor.endLine, anchor.endChar],
    [0, 0, 0, source.length],
  );
  assert.deepEqual(rendered, selection);
  assertRelocated(source, anchor, 0);
});

test('a context-free whole-document quote relocates to its unique surviving occurrence', () => {
  const { anchor } = persist('target', { quote: 'target' });
  assert.equal(anchor.before, '');
  assert.equal(anchor.after, '');
  for (const edited of ['new\ntarget', 'prefix target suffix', 'target\nnew']) {
    assertRelocated(edited, anchor, edited.indexOf('target'));
  }
});

test('a moved context-free quote with multiple surviving occurrences remains orphaned', () => {
  const { anchor } = persist('target', { quote: 'target' });
  assert.equal(relocate(new Document('new\ntarget\ntarget'), anchor), null);
  assert.equal(relocate(new Document('prefix target and target'), anchor), null);
});

test('a context-free quote still at its original coordinates survives even with later duplicates', () => {
  const { anchor } = persist('target', { quote: 'target' });
  assertRelocated('target\nother target', anchor, 0);
});
