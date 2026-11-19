import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import deflist from 'markdown-it-deflist';
import { full as emoji } from 'markdown-it-emoji';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import { parseDocument } from 'yaml';
import { gfmAlertsPlugin } from './gfm-alerts';
import { headingSlug, headingTextFromInline } from './heading';
import { isSafeHref, isSafeImageSource, sanitizeHtml, sanitizeInlineHtmlToken } from './sanitize';

export type FrontMatterMode = 'table' | 'codeBlock' | 'hide';

export interface MarkdownRenderOptions {
  frontMatter?: FrontMatterMode;
  breaks?: boolean;
  typographer?: boolean;
  html?: 'strict' | 'safe';
}

export interface MarkdownRenderer {
  render: (markdown: string, options?: MarkdownRenderOptions) => string;
}

interface RenderEnvironment {
  frontMatter: FrontMatterMode;
  headingCounts: Map<string, number>;
  safeHtml: boolean;
}

const DEFAULT_RENDER_OPTIONS: Required<MarkdownRenderOptions> = {
  frontMatter: 'table',
  breaks: false,
  typographer: false,
  html: 'strict',
};

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerAliases('shell', { languageName: 'bash' });
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('sql', sql);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }) as const
      )[character as '&' | '<' | '>' | '"' | "'"],
  );
}

/** Strip HTML comments outside fenced code so strict mode does not show escaped leftovers. */
function stripHtmlCommentsOutsideFences(source: string): string {
  let result = '';
  let index = 0;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  while (index < source.length) {
    const atLineStart = index === 0 || source[index - 1] === '\n';
    if (atLineStart && (source[index] === '`' || source[index] === '~')) {
      const lineEnd = source.indexOf('\n', index);
      const line = lineEnd === -1 ? source.slice(index) : source.slice(index, lineEnd);
      const fence = /^(```+|~~~+)/.exec(line);
      if (fence) {
        const marker = fence[1][0];
        const { length } = fence[1];
        if (!inFence) {
          inFence = true;
          fenceChar = marker;
          fenceLength = length;
        } else if (marker === fenceChar && length >= fenceLength && line.slice(length).trim() === '') {
          inFence = false;
          fenceChar = '';
          fenceLength = 0;
        }
      }
    }

    if (!inFence && source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end === -1) {
        break;
      }
      index = end + 3;
      continue;
    }

    // In strict mode, drop always-dangerous raw tags (and paired bodies) so they are not noisy escaped text.
    if (!inFence && source[index] === '<') {
      const paired = /<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/i.exec(
        source.slice(index),
      );
      if (paired && paired.index === 0) {
        index += paired[0].length;
        continue;
      }
      const lonely = /<\/?(?:script|style|iframe|object|embed|form|input|button)\b[^>]*\/?>/i.exec(
        source.slice(index),
      );
      if (lonely && lonely.index === 0) {
        index += lonely[0].length;
        continue;
      }
    }

    result += source[index];
    index += 1;
  }

  return result;
}

function languageFromInfo(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

// Detection is deliberately conservative: short, ambiguous, or large blocks stay txt.
// highlight.js relevance is a heuristic, not a probability of correctness.
function highlightCode(
  source: string,
  language: string,
): { html: string; language: string; highlighted: boolean } {
  const plain = { html: escapeHtml(source), language: 'txt', highlighted: false };
  if (language) {
    if (['txt', 'text', 'plaintext', 'plain', 'none', 'nohighlight'].includes(language)) {
      return plain;
    }
    // Keep explicitly named, unsupported languages visible, but never inject fence info into markup.
    const label = /^[a-z0-9][a-z0-9_+#.-]{0,49}$/.test(language) ? language : 'txt';
    if (!hljs.getLanguage(language)) {
      return { ...plain, language: label };
    }
    try {
      return {
        html: hljs.highlight(source, { language, ignoreIllegals: true }).value,
        language: label,
        highlighted: true,
      };
    } catch {
      return { ...plain, language: label };
    }
  }
  if (source.trim().length < 20 || source.length > 10_000) {
    return plain;
  }
  try {
    const result = hljs.highlightAuto(source);
    if (
      result.language &&
      result.relevance >= 5 &&
      result.relevance - (result.secondBest?.relevance ?? 0) >= 2
    ) {
      return { html: result.value, language: result.language, highlighted: true };
    }
  } catch {
    // A failing grammar must not prevent the rest of the document from rendering.
  }
  return plain;
}

function renderCode(source: string, language: string): string {
  const highlighted = highlightCode(source, language);
  const className = highlighted.highlighted
    ? ` class="hljs language-${escapeHtml(highlighted.language)}"`
    : '';
  return `<code${className} data-code-language="${escapeHtml(highlighted.language)}">${highlighted.html}</code>`;
}

function renderYamlValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || value === undefined) {
    return '<span class="mdc-front-matter-null">null</span>';
  }
  if (typeof value === 'string') {
    return `<span class="mdc-front-matter-string">${escapeHtml(value).replace(/\r?\n/g, '<br>')}</span>`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `<code>${escapeHtml(String(value))}</code>`;
  }
  if (typeof value !== 'object') {
    return `<span>${escapeHtml(String(value))}</span>`;
  }
  if (ancestors.has(value)) {
    return '<span class="mdc-front-matter-circular">[Circular]</span>';
  }

  ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const rows = entries
    .map(
      ([key, item]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${renderYamlValue(item, ancestors)}</td></tr>`,
    )
    .join('');
  ancestors.delete(value);

  return `<table class="mdc-front-matter-table"><tbody>${rows}</tbody></table>`;
}

function parseFrontMatter(source: string): unknown {
  const document = parseDocument(source, {
    customTags: [],
    schema: 'core',
  });
  if (document.errors.length > 0) {
    throw document.errors[0];
  }
  return document.toJS({ maxAliasCount: 100 });
}

function hashSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createMarkdownIt(context: 'document' | 'comment'): MarkdownIt {
  const markdown = new MarkdownIt({
    breaks: false,
    html: false,
    linkify: true,
  });

  markdown.use(taskLists, { enabled: false });
  markdown.use(footnote);
  markdown.use(deflist);
  markdown.use(emoji);
  markdown.use(gfmAlertsPlugin);
  markdown.use(texmath, {
    delimiters: 'dollars',
    engine: katex,
    katexOptions: {
      strict: 'ignore',
      throwOnError: false,
      trust: false,
    },
  });

  markdown.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0) {
      return false;
    }

    const openingLine = state.src
      .slice(state.bMarks[startLine], state.eMarks[startLine])
      .replace(/^\uFEFF/, '');
    if (openingLine.trim() !== '---') {
      return false;
    }

    let closingLine = startLine + 1;
    while (closingLine < endLine) {
      const line = state.src.slice(state.bMarks[closingLine], state.eMarks[closingLine]);
      if (line.trim() === '---') {
        break;
      }
      closingLine += 1;
    }
    if (closingLine >= endLine) {
      return false;
    }
    if (silent) {
      return true;
    }

    const token = state.push('front_matter', 'section', 0);
    token.block = true;
    token.content = state.src.slice(state.bMarks[startLine + 1], state.bMarks[closingLine]);
    token.map = [startLine, closingLine + 1];
    state.line = closingLine + 1;
    return true;
  });

  // Generate only these two native elements. Do not forward source HTML attributes.
  const disclosureOpen = /^<details(?:\s+(open)(?:\s*=\s*(?:"(?:open)?"|'(?:open)?'|open))?)?\s*>/i;
  const disclosureClose = /^<\/details\s*>$/i;
  const compactDisclosure = /^<summary\s*>(.*?)<\/summary\s*>(.*?)<\/details\s*>$/i;
  const summaryStart = /^<summary\s*>/i;
  const summaryEnd = /<\/summary\s*>\s*$/i;

  markdown.block.ruler.before(
    'html_block',
    'safe_details',
    (state, startLine, endLine, silent) => {
      const readLine = (line: number) =>
        state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
      const openingLine = readLine(startLine);
      const opening = disclosureOpen.exec(openingLine);
      if (!opening) {
        return false;
      }
      const rest = openingLine.slice(opening[0].length).trim();
      if (rest && !summaryStart.test(rest)) {
        return false;
      }

      const addSummary = (source: string, start: number, end: number) => {
        const label = state.push('summary_open', 'summary', 1);
        label.map = [start, end];
        const inline = state.push('inline', '', 0);
        inline.content = source;
        inline.children = [];
        state.push('summary_close', 'summary', -1);
      };
      const addOpening = (end: number) => {
        const open = state.push('details_open', 'details', 1);
        open.map = [startLine, end];
        if (opening[1]) {
          open.attrSet('open', '');
        }
      };
      const compact = compactDisclosure.exec(rest);
      if (compact) {
        if (silent) {
          return true;
        }
        const end = startLine + 1;
        addOpening(end);
        addSummary(compact[1], startLine, end);
        if (compact[2].trim()) {
          const paragraph = state.push('paragraph_open', 'p', 1);
          paragraph.map = [startLine, end];
          const body = state.push('inline', '', 0);
          body.content = compact[2].trim();
          body.children = [];
          state.push('paragraph_close', 'p', -1);
        }
        state.push('details_close', 'details', -1);
        state.line = end;
        return true;
      }

      let closingLine = startLine + 1;
      let depth = 1;
      let fence: { marker: string; length: number } | undefined;
      while (closingLine < endLine) {
        if (state.sCount[closingLine] < state.blkIndent && !state.isEmpty(closingLine)) {
          return false;
        }
        if (state.sCount[closingLine] - state.blkIndent >= 4) {
          closingLine += 1;
          continue;
        }
        const line = readLine(closingLine);
        if (fence) {
          if (new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(line)) {
            fence = undefined;
          }
        } else {
          const fenceOpening = /^(`{3,}|~{3,})/.exec(line);
          const nested = disclosureOpen.exec(line);
          if (fenceOpening) {
            fence = { marker: fenceOpening[1][0], length: fenceOpening[1].length };
          } else if (nested) {
            const tail = line.slice(nested[0].length).trim();
            if (!tail || (summaryStart.test(tail) && !compactDisclosure.test(tail))) {
              depth += 1;
            }
          } else if (disclosureClose.test(line) && --depth === 0) {
            break;
          }
        }
        closingLine += 1;
      }
      if (closingLine >= endLine) {
        return false;
      }

      let bodyStart = startLine + 1;
      while (bodyStart < closingLine && state.isEmpty(bodyStart)) {
        bodyStart += 1;
      }
      const summaryLine = rest ? startLine : bodyStart;
      const firstSummaryLine = rest || readLine(summaryLine);
      const summaryOpening = summaryStart.exec(firstSummaryLine);
      let summary: { text: string; end: number } | undefined;
      if (summaryOpening) {
        const lines = [firstSummaryLine.slice(summaryOpening[0].length)];
        for (let line = summaryLine; line < closingLine; line++) {
          if (line !== summaryLine) {
            const next = readLine(line);
            if (disclosureOpen.test(next) || summaryStart.test(next) || disclosureClose.test(next)) {
              break;
            }
            lines.push(next);
          }
          const last = lines.length - 1;
          const summaryClosing = summaryEnd.exec(lines[last]);
          if (summaryClosing) {
            lines[last] = lines[last].slice(0, summaryClosing.index);
            summary = { text: lines.join('\n').trim(), end: line + 1 };
            bodyStart = line + 1;
            break;
          }
        }
      }
      if (rest && !summary) {
        return false;
      }
      if (silent) {
        return true;
      }

      addOpening(closingLine + 1);
      if (summary) {
        addSummary(summary.text, summaryLine, summary.end);
      }

      if (bodyStart < closingLine) {
        // Keep the original block state and line offsets (including block quotes/lists).
        const lineMax = state.lineMax;
        const parentType = state.parentType;
        const tight = state.tight;
        state.lineMax = closingLine;
        try {
          state.md.block.tokenize(state, bodyStart, closingLine);
        } finally {
          state.lineMax = lineMax;
          state.parentType = parentType;
          state.tight = tight;
        }
      }

      state.push('details_close', 'details', -1);
      state.line = closingLine + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  markdown.core.ruler.push('source_map', (state) => {
    if (context === 'comment') {
      return;
    }
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (!token.map || token.nesting === -1) {
        continue;
      }
      token.attrJoin('class', 'mdc-source-block');
      token.attrSet('data-line', String(token.map[0]));
      token.attrSet('data-end-line', String(token.map[1]));
      if (
        token.type === 'html_block' ||
        (token.type.endsWith('_open') &&
          state.tokens[index + 1]?.type === 'inline' &&
          state.tokens[index + 1]?.children?.some((child) => child.type === 'html_inline'))
      ) {
        let target = token;
        if (token.hidden) {
          for (let parentIndex = index - 1; parentIndex >= 0; parentIndex--) {
            const candidate = state.tokens[parentIndex];
            if (
              candidate.nesting === 1 &&
              candidate.map &&
              candidate.map[0] <= token.map[0] &&
              token.map[1] <= candidate.map[1] &&
              !candidate.hidden
            ) {
              target = candidate;
              break;
            }
          }
        }
        target.attrJoin('class', 'mdc-safe-html-block');
        token.attrJoin('class', 'mdc-safe-html-block');
      }
    }
  });

  // Tight-list paragraphs normally disappear from the DOM. Retain an inline
  // source boundary so selecting the parent's text cannot absorb its nested list.
  for (const type of ['paragraph_open', 'paragraph_close']) {
    markdown.renderer.rules[type] = (tokens, index, options, _environment, renderer) => {
      const token = tokens[index];
      if (context !== 'comment' && token.hidden) {
        return token.nesting === 1 ? `<span${renderer.renderAttrs(token)}>` : '</span>';
      }
      return renderer.renderToken(tokens, index, options);
    };
  }

  markdown.renderer.rules.front_matter = (tokens, index, _options, environment, renderer) => {
    const token = tokens[index];
    const mode = (environment as RenderEnvironment).frontMatter;

    token.attrJoin('class', 'mdc-front-matter');
    token.attrSet('data-front-matter-mode', mode);

    if (mode === 'hide') {
      token.attrJoin('class', 'mdc-front-matter-hidden');
      return `<div${renderer.renderAttrs(token)} hidden aria-hidden="true"></div>\n`;
    }
    if (mode === 'codeBlock') {
      token.attrJoin('class', 'mdc-front-matter-code');
      return `<pre${renderer.renderAttrs(token)}>${renderCode(token.content, 'yaml')}</pre>\n`;
    }

    token.attrJoin('class', 'mdc-front-matter-table-container');
    try {
      const value = parseFrontMatter(token.content);
      return `<section${renderer.renderAttrs(token)}>${renderYamlValue(value, new WeakSet())}</section>\n`;
    } catch {
      token.attrJoin('class', 'mdc-front-matter-invalid');
      return `<pre${renderer.renderAttrs(token)}>${renderCode(token.content, 'yaml')}</pre>\n`;
    }
  };

  const renderFence: NonNullable<typeof markdown.renderer.rules.fence> = (
    tokens,
    index,
    _options,
    _environment,
    renderer,
  ) => {
    const token = tokens[index];
    const language = languageFromInfo(token.info);

    if (language === 'mermaid' && context === 'document') {
      const startLine = token.map?.[0] ?? 0;
      token.attrJoin('class', 'mdc-mermaid');
      token.attrSet('data-diagram-key', `${startLine}:${hashSource(token.content)}`);
      return [
        `<div${renderer.renderAttrs(token)}>`,
        '<div class="mdc-mermaid-canvas" aria-label="Mermaid 图"></div>',
        `<template class="mdc-mermaid-source">${escapeHtml(token.content)}</template>`,
        '</div>\n',
      ].join('');
    }

    return `<pre${renderer.renderAttrs(token)}>${renderCode(token.content, language)}</pre>\n`;
  };
  markdown.renderer.rules.fence = renderFence;
  markdown.renderer.rules.code_block = (tokens, index, _options, _environment, renderer) => {
    const token = tokens[index];
    return `<pre${renderer.renderAttrs(token)}>${renderCode(token.content, '')}</pre>\n`;
  };

  for (const ruleName of ['math_block', 'math_block_eqno'] as const) {
    const renderMath = markdown.renderer.rules[ruleName];
    if (!renderMath) {
      continue;
    }
    markdown.renderer.rules[ruleName] = (tokens, index, options, environment, renderer) =>
      `<div${renderer.renderAttrs(tokens[index])}>${renderMath(tokens, index, options, environment, renderer)}</div>\n`;
  }

  const renderImage = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const source = token.attrGet('src');
    if (source === null || !isSafeImageSource(source)) {
      return escapeHtml(token.content || '');
    }
    token.attrSet('data-src', source);
    return renderImage
      ? renderImage(tokens, index, options, environment, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.link_open = (tokens, index, options, _environment, renderer) => {
    const token = tokens[index];
    const href = token.attrGet('href');
    if (href !== null && isSafeHref(href)) {
      token.attrSet('data-href', href);
    } else {
      token.attrs = token.attrs?.filter(([name]) => name !== 'href' && name !== 'data-href') ?? null;
    }
    return renderer.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.html_block = (tokens, index, _options, environment, renderer) => {
    const token = tokens[index];
    token.attrJoin('class', 'mdc-safe-html-block');
    const sanitized = sanitizeHtml(token.content);
    return sanitized ? `<div${renderer.renderAttrs(token)}>${sanitized}</div>\n` : '';
  };
  markdown.renderer.rules.html_inline = (tokens, index) => sanitizeInlineHtmlToken(tokens[index].content);

  const renderHeadingOpen = markdown.renderer.rules.heading_open;
  markdown.renderer.rules.heading_open = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const env = environment as RenderEnvironment;
    const base = headingSlug(headingTextFromInline(tokens[index + 1]));
    const count = env.headingCounts.get(base) ?? 0;
    env.headingCounts.set(base, count + 1);
    token.attrSet('id', count === 0 ? base : `${base}-${count}`);
    return renderHeadingOpen
      ? renderHeadingOpen(tokens, index, options, environment, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  return markdown;
}

export function createMarkdownRenderer(
  defaultOptions: MarkdownRenderOptions = {},
  context: 'document' | 'comment' = 'document',
): MarkdownRenderer {
  const markdown = createMarkdownIt(context);
  const resolvedDefaults = {
    ...DEFAULT_RENDER_OPTIONS,
    ...defaultOptions,
  };

  return {
    render(source, options = {}) {
      const resolvedOptions = {
        ...resolvedDefaults,
        ...options,
      };
      markdown.set({
        breaks: resolvedOptions.breaks,
        typographer: resolvedOptions.typographer,
        html: resolvedOptions.html === 'safe',
      });
      const environment: RenderEnvironment = {
        frontMatter: resolvedOptions.frontMatter,
        headingCounts: new Map(),
        safeHtml: resolvedOptions.html === 'safe',
      };
      const markdownSource =
        resolvedOptions.html === 'safe' ? source : stripHtmlCommentsOutsideFences(source);
      return markdown.render(markdownSource, environment);
    },
  };
}
