import { GENERATED_TOOLBARS } from './selection-range';

const HIGHLIGHT_NAME = 'mdc-selection-draft';
const OMITTED = `${GENERATED_TOOLBARS}, .mdc-diff-deleted-marker, template`;

export interface DraftHighlight {
  start: number;
  end: number;
  text: string;
}

type Registry = Pick<Map<string, Highlight>, 'delete' | 'set'>;
function registry(): Registry | undefined {
  const css = globalThis.CSS as (typeof CSS & { highlights?: Registry }) | undefined;
  return typeof globalThis.Highlight === 'function' ? css?.highlights : undefined;
}

function* sourceText(root: HTMLElement): Iterable<Text> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(OMITTED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      yield node;
    }
  }
}

export function captureDraftHighlight(root: HTMLElement, range: Range): DraftHighlight | undefined {
  if (!registry()) {
    return undefined;
  }
  let offset = 0;
  let start: number | undefined;
  let end = 0;
  let text = '';
  for (const node of sourceText(root)) {
    if (range.intersectsNode(node)) {
      const part = document.createRange();
      part.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
        part.setStart(range.startContainer, range.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
        part.setEnd(range.endContainer, range.endOffset);
      }
      if (!part.collapsed) {
        start ??= offset + part.startOffset;
        end = offset + part.endOffset;
        text += part.toString();
      }
    }
    offset += node.length;
  }
  if (start !== undefined && text.trim()) {
    return { start, end, text };
  }
  return undefined;
}

/** Use separate ranges in text nodes, not wrappers that can change table structure. */
export function paintDraftHighlight(root: HTMLElement | null, snapshot: DraftHighlight | undefined): void {
  const highlights = registry();
  if (!highlights) {
    return;
  }
  highlights.delete(HIGHLIGHT_NAME);
  if (!root || !snapshot) {
    return;
  }
  let offset = 0;
  let text = '';
  const ranges: Range[] = [];
  for (const node of sourceText(root)) {
    const start = Math.max(snapshot.start - offset, 0);
    const end = Math.min(snapshot.end - offset, node.length);
    if (start < end) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      text += range.toString();
      ranges.push(range);
    }
    offset += node.length;
    if (offset >= snapshot.end) {
      break;
    }
  }
  // Rendering preferences can change the rendered text without editing the source.
  // When offsets no longer match, never paint unrelated text.
  if (text === snapshot.text) {
    highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  }
}
