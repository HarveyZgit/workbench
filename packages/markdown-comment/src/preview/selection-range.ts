/// <reference lib="dom" />

export const GENERATED_TOOLBARS = '.mdc-code-toolbar, .mdc-image-tools';

const SOURCE_BLOCK = '[data-line][data-end-line]';
const GENERATED_TEXT = `${GENERATED_TOOLBARS}, .katex-mathml, [aria-hidden="true"], template`;

export function nearestSourceBlock(node: Node): HTMLElement | null {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(SOURCE_BLOCK) ?? null;
}

/** Use the text actually selected, not the container at a DOM boundary. A range
 * ending at the next item's offset zero must not include that next item. */
export function selectedSourceBlocks(content: HTMLElement, range: Range): [HTMLElement, HTMLElement] | null {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let first: HTMLElement | null = null;
  let last: HTMLElement | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(`${GENERATED_TOOLBARS}, template`) || !range.intersectsNode(node)) {
      continue;
    }
    const selected = document.createRange();
    selected.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, selected) > 0) {
      selected.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, selected) < 0) {
      selected.setEnd(range.endContainer, range.endOffset);
    }
    if (!selected.toString().trim()) {
      continue;
    }
    const block = nearestSourceBlock(node);
    if (block) {
      first ??= block;
      last = block;
    }
  }
  return first && last ? [first, last] : null;
}

/** Keep fully covered blocks, descend into partially covered containers. Never
 * paint an entire list/quote/table just because one child overlaps the anchor.
 * Text owned by a partial container (tight list items) is handled separately. */
export function sourceRangeTargets(
  content: HTMLElement,
  startLine: number,
  endLine: number,
): (HTMLElement | Text)[] {
  const targets: (HTMLElement | Text)[] = [];
  const visit = (element: HTMLElement): void => {
    if (element.matches(GENERATED_TEXT)) {
      return;
    }
    const mapped = element.matches(SOURCE_BLOCK);
    const start = Number(element.dataset.line);
    const end = Number(element.dataset.endLine);
    if (mapped && (start >= endLine || end <= startLine)) {
      return;
    }
    if (mapped && ((start >= startLine && end <= endLine) || !element.querySelector(SOURCE_BLOCK))) {
      targets.push(element);
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      if (child instanceof HTMLElement) {
        visit(child);
      } else if (child instanceof Text && child.data.trim()) {
        const owner = nearestSourceBlock(child);
        const ownerStart = Number(owner?.dataset.line);
        if (owner && ownerStart >= startLine && ownerStart < endLine) {
          targets.push(child);
        }
      }
    }
  };
  visit(content);
  return targets;
}
