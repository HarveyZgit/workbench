import {
  CONTEXT_LEN,
  OUTER_HTML_MAX,
  QUOTE_MAX,
  RELOCATE_THRESHOLD,
  SNAPSHOT_TEXT_MAX,
  type CapturedTarget,
  type RelocateCandidate,
  type StoredAnchor,
} from './types.js';

export function foldWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function clip(s: string, n: number): string {
  const t = foldWhitespace(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function takeTail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(s.length - n);
}

function takeHead(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function cap(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

export function buildAnchor(captured: CapturedTarget, pageTitle: string): StoredAnchor {
  const quote = cap(foldWhitespace(captured.quote), QUOTE_MAX);
  const before = takeTail(foldWhitespace(captured.before), CONTEXT_LEN);
  const after = takeHead(foldWhitespace(captured.after), CONTEXT_LEN);
  const textContent = cap(foldWhitespace(captured.textContent), SNAPSHOT_TEXT_MAX);
  const outerHTML = cap(captured.outerHTML, OUTER_HTML_MAX);
  const snapshot = { pageTitle, outerHTML, textContent };
  if (captured.kind === 'area') {
    return {
      kind: 'area',
      rect: { ...captured.rect },
      quote,
      before,
      after,
      snapshot,
    };
  }
  if (captured.kind === 'text') {
    return {
      kind: 'text',
      css: captured.css,
      xpath: captured.xpath,
      tagName: captured.tagName,
      id: captured.id,
      hints: captured.hints,
      quote,
      before,
      after,
      startOffset: captured.startOffset,
      endOffset: captured.endOffset,
      rect: { ...captured.rect },
      snapshot,
    };
  }
  return {
    kind: 'element',
    css: captured.css,
    xpath: captured.xpath,
    tagName: captured.tagName,
    id: captured.id,
    hints: captured.hints,
    quote,
    before,
    after,
    snapshot,
  };
}

type QuoteStrength = 'strong' | 'weak' | 'none';
type ContextMatch = 'both' | 'after' | 'before' | 'none';

export function quoteStrength(anchor: StoredAnchor, c: RelocateCandidate): QuoteStrength {
  const { quote } = anchor;
  if (!quote) {
    return 'none';
  }
  if (c.text === quote || c.text.startsWith(quote)) {
    return 'strong';
  }
  if (c.text.includes(quote)) {
    return 'weak';
  }
  return 'none';
}

export function contextMatch(anchor: StoredAnchor, c: RelocateCandidate): ContextMatch {
  const beforeHit = Boolean(anchor.before) && c.before.endsWith(anchor.before);
  const afterHit = Boolean(anchor.after) && c.after.startsWith(anchor.after);
  if (beforeHit && afterHit) {
    return 'both';
  }
  if (afterHit) {
    return 'after';
  }
  if (beforeHit) {
    return 'before';
  }
  return 'none';
}

export function scoreCandidate(anchor: StoredAnchor, c: RelocateCandidate): number {
  const q = quoteStrength(anchor, c);
  const ctx = contextMatch(anchor, c);
  let score = 0;
  const strongBoth = 1_000_000;
  const strongAfterOrWeakBoth = 10_000;
  const strongOtherOrWeakSide = 1_000;
  const cssOrRect = 100;
  const xpathHit = 50;
  const idOrTestId = 40;
  if (q === 'strong' && ctx === 'both') {
    score += strongBoth;
  } else if (q === 'strong' && ctx === 'after') {
    score += strongAfterOrWeakBoth;
  } else if (q === 'strong') {
    score += strongOtherOrWeakSide;
  } else if (q === 'weak' && ctx === 'both') {
    score += strongAfterOrWeakBoth;
  } else if (q === 'weak' && (ctx === 'after' || ctx === 'before')) {
    score += strongOtherOrWeakSide;
  }
  if (c.cssMatched) {
    score += cssOrRect;
  }
  if (c.rectMatched) {
    score += cssOrRect;
  }
  if (c.xpathMatched) {
    score += xpathHit;
  }
  if (c.idMatched) {
    score += idOrTestId;
  }
  if (c.testIdMatched) {
    score += idOrTestId;
  }
  if (anchor.kind === 'element' && c.tagName !== '' && c.tagName === anchor.tagName) {
    score += 1;
  }
  return score;
}

export function pickCandidate(anchor: StoredAnchor, cs: RelocateCandidate[]): number | null {
  if (cs.length === 0) {
    return null;
  }
  const immediate: number[] = [];
  for (let i = 0; i < cs.length; i += 1) {
    const c = cs[i];
    const strong = quoteStrength(anchor, c) === 'strong';
    if ((anchor.kind === 'element' || anchor.kind === 'text') && c.cssMatched && strong) {
      immediate.push(i);
    }
    if (anchor.kind === 'area' && c.rectMatched && strong) {
      immediate.push(i);
    }
  }
  if (immediate.length === 1) {
    return immediate[0];
  }
  if (anchor.quote === '') {
    const locatorHits: number[] = [];
    const idHits: number[] = [];
    for (let i = 0; i < cs.length; i += 1) {
      const c = cs[i];
      const loc = anchor.kind === 'area' ? c.rectMatched : c.cssMatched;
      if (loc) {
        locatorHits.push(i);
      }
      if (c.idMatched || c.testIdMatched) {
        idHits.push(i);
      }
    }
    if (locatorHits.length === 1) {
      return locatorHits[0];
    }
    if (idHits.length === 1) {
      return idHits[0];
    }
  }
  let best = 0;
  let bestScore = scoreCandidate(anchor, cs[0]);
  for (let i = 1; i < cs.length; i += 1) {
    const sc = scoreCandidate(anchor, cs[i]);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  if (bestScore < RELOCATE_THRESHOLD) {
    return null;
  }
  return best;
}
