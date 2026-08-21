/// <reference lib="dom" />

import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
] as const;

const GLOBAL_ATTRIBUTES = new Set(['class', 'dir', 'hidden', 'id', 'lang', 'title']);
const TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  del: new Set(['datetime']),
  details: new Set(['open']),
  img: new Set(['alt', 'decoding', 'height', 'loading', 'src', 'width']),
  ins: new Set(['datetime']),
  li: new Set(['value']),
  ol: new Set(['reversed', 'start']),
  td: new Set(['colspan', 'headers', 'rowspan']),
  th: new Set(['abbr', 'colspan', 'headers', 'rowspan', 'scope']),
  time: new Set(['datetime']),
};
const ALLOWED_ATTRIBUTES = [
  ...GLOBAL_ATTRIBUTES,
  ...new Set(Object.values(TAG_ATTRIBUTES).flatMap((attributes) => [...attributes])),
];

const FORBIDDEN_TAGS = ['button', 'embed', 'form', 'iframe', 'input', 'object', 'script', 'style'] as const;
// Strip C0 controls and Unicode whitespace from URIs before scheme checks.
// eslint-disable-next-line no-control-regex -- \u0000 is an intentional C0 range bound
const URI_WHITESPACE = /[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]/g;
const URI_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]*$/i;
const VOID_TAGS = new Set(['br', 'col', 'hr', 'img', 'wbr']);

function isAllowedAttribute(tagName: string, attributeName: string): boolean {
  return GLOBAL_ATTRIBUTES.has(attributeName) || TAG_ATTRIBUTES[tagName]?.has(attributeName) === true;
}

function normalizedUri(value: string): string {
  return value.trim().replace(URI_WHITESPACE, '');
}

function isRelativeUri(value: string): boolean {
  return !value.startsWith('//') && !value.startsWith('\\\\') && !URI_SCHEME.test(value);
}

function isSafeHref(value: string): boolean {
  const uri = normalizedUri(value);
  if (isRelativeUri(uri)) {
    return true;
  }
  const scheme = URI_SCHEME.exec(uri)?.[1].toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

function isSafeImageSource(value: string): boolean {
  const uri = normalizedUri(value);
  if (isRelativeUri(uri)) {
    return true;
  }
  const scheme = URI_SCHEME.exec(uri)?.[1].toLowerCase();
  return scheme === 'https' || SAFE_IMAGE_DATA_URI.test(uri);
}

function createPurifier() {
  const purifier = createDOMPurify(globalThis);
  purifier.addHook('uponSanitizeAttribute', (element, event) => {
    const tagName = element.tagName.toLowerCase();
    if (!isAllowedAttribute(tagName, event.attrName)) {
      event.keepAttr = false;
      return;
    }
    if ((event.attrName === 'href' || event.attrName === 'data-href') && !isSafeHref(event.attrValue)) {
      event.keepAttr = false;
    } else if (
      (event.attrName === 'src' || event.attrName === 'data-src') &&
      !isSafeImageSource(event.attrValue)
    ) {
      event.keepAttr = false;
    }
  });
  return purifier;
}

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  CUSTOM_ELEMENT_HANDLING: {
    tagNameCheck: null,
    attributeNameCheck: null,
    allowCustomizedBuiltInElements: false,
  },
  FORBID_ATTR: ['style', 'target'],
  FORBID_TAGS: [...FORBIDDEN_TAGS],
  KEEP_CONTENT: false,
  RETURN_TRUSTED_TYPE: false,
  SANITIZE_DOM: true,
};

export function sanitizeHtml(input: string): string {
  return createPurifier().sanitize(input, SANITIZE_OPTIONS);
}

export function sanitizeInlineHtmlToken(input: string): string {
  const closing = /^<\s*\/\s*([a-z][a-z0-9-]*)\s*>$/i.exec(input);
  if (closing) {
    const tagName = closing[1].toLowerCase();
    return ALLOWED_TAGS.includes(tagName as (typeof ALLOWED_TAGS)[number]) && !VOID_TAGS.has(tagName)
      ? `</${tagName}>`
      : '';
  }
  const opening = /^<\s*([a-z][a-z0-9-]*)\b[\s\S]*>$/i.exec(input);
  if (!opening) {
    return '';
  }
  const tagName = opening[1].toLowerCase();
  if (!ALLOWED_TAGS.includes(tagName as (typeof ALLOWED_TAGS)[number])) {
    return '';
  }
  if (VOID_TAGS.has(tagName)) {
    return sanitizeHtml(input);
  }
  const marker = 'mdc-inline-html-marker';
  const sanitized = sanitizeHtml(`${input}${marker}</${tagName}>`);
  const markerIndex = sanitized.indexOf(marker);
  return markerIndex >= 0 ? sanitized.slice(0, markerIndex) : '';
}
