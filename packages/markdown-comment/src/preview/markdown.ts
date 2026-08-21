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
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import { parseDocument } from 'yaml';
import { headingSlug, headingTextFromInline } from './heading';
import { sanitizeHtml, sanitizeInlineHtmlToken } from './sanitize';

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

function languageFromInfo(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function highlightCode(source: string, language: string): { html: string; language: string | null } {
  if (!language || !hljs.getLanguage(language)) {
    return { html: escapeHtml(source), language: null };
  }

  try {
    return {
      html: hljs.highlight(source, { language, ignoreIllegals: true }).value,
      language,
    };
  } catch {
    return { html: escapeHtml(source), language: null };
  }
}

function renderCode(source: string, language: string): string {
  const highlighted = highlightCode(source, language);
  const className = highlighted.language ? ` class="hljs language-${escapeHtml(highlighted.language)}"` : '';
  return `<code${className}>${highlighted.html}</code>`;
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

type MarkdownToken = ReturnType<MarkdownIt['parse']>[number];

function createMarkdownIt(): MarkdownIt {
  const markdown = new MarkdownIt({
    breaks: false,
    html: false,
    linkify: true,
  });

  markdown.use(taskLists, { enabled: false });
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

  markdown.block.ruler.before('html_block', 'safe_details', (state, startLine, endLine, silent) => {
    const opening = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]).trim();
    const openingMatch = /^<details(?:\s+(open))?\s*>$/i.exec(opening);
    if (!openingMatch) {
      return false;
    }
    let closingLine = startLine + 1;
    let detailsDepth = 1;
    let fence: { marker: string; length: number } | undefined;
    while (closingLine < endLine) {
      const line = state.src.slice(state.bMarks[closingLine], state.eMarks[closingLine]).trim();
      if (fence) {
        if (new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(line)) {
          fence = undefined;
        }
        closingLine += 1;
        continue;
      }
      const fenceOpening = /^(`{3,}|~{3,})/.exec(line);
      if (fenceOpening) {
        fence = { marker: fenceOpening[1][0], length: fenceOpening[1].length };
        closingLine += 1;
        continue;
      }
      if (/^<details(?:\s+open)?\s*>$/i.test(line)) {
        detailsDepth += 1;
      } else if (/^<\/details\s*>$/i.test(line)) {
        detailsDepth -= 1;
        if (detailsDepth === 0) {
          break;
        }
      }
      closingLine += 1;
    }
    if (closingLine >= endLine) {
      return false;
    }
    if (silent) {
      return true;
    }

    const open = state.push('details_open', 'details', 1);
    open.block = true;
    open.map = [startLine, closingLine + 1];
    if (openingMatch[1]) {
      open.attrSet('open', '');
    }

    let bodyStartLine = startLine + 1;
    const summaryLine = state.src.slice(state.bMarks[bodyStartLine], state.eMarks[bodyStartLine]).trim();
    const summaryMatch = /^<summary>([\s\S]*?)<\/summary\s*>$/i.exec(summaryLine);
    if (summaryMatch) {
      state.push('summary_open', 'summary', 1);
      const summary = state.push('inline', '', 0);
      summary.content = summaryMatch[1];
      summary.children = [];
      summary.map = [bodyStartLine, bodyStartLine + 1];
      state.push('summary_close', 'summary', -1);
      bodyStartLine += 1;
    }

    if (bodyStartLine < closingLine) {
      const bodySource = state.getLines(bodyStartLine, closingLine, state.blkIndent, false);
      const bodyTokens: MarkdownToken[] = [];
      state.md.block.parse(bodySource, state.md, state.env, bodyTokens);
      for (const token of bodyTokens) {
        if (token.map) {
          token.map = [token.map[0] + bodyStartLine, token.map[1] + bodyStartLine];
        }
        state.tokens.push(token);
      }
    }

    state.push('details_close', 'details', -1);
    state.line = closingLine + 1;
    return true;
  });

  markdown.core.ruler.push('source_map', (state) => {
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
      }
    }
  });

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

    if (language === 'mermaid') {
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
    return `<pre${renderer.renderAttrs(token)}><code>${escapeHtml(token.content)}</code></pre>\n`;
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
    if (source !== null) {
      token.attrSet('data-src', source);
    }
    return renderImage
      ? renderImage(tokens, index, options, environment, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.link_open = (tokens, index, options, _environment, renderer) => {
    const token = tokens[index];
    const href = token.attrGet('href');
    if (href !== null) {
      token.attrSet('data-href', href);
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

export function createMarkdownRenderer(defaultOptions: MarkdownRenderOptions = {}): MarkdownRenderer {
  const markdown = createMarkdownIt();
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
      return markdown.render(source, environment);
    },
  };
}
