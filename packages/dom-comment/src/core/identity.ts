const TRACKING_KEYS = /^(utm_|gclid|fbclid|msclkid|mc_eid)/i;

export function canonicalizeUrl(href: string): string {
  const u = new URL(href);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`unsupported URL scheme: ${u.protocol}`);
  }
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  const toDelete: string[] = [];
  u.searchParams.forEach((_, key) => {
    if (TRACKING_KEYS.test(key)) {
      toDelete.push(key);
    }
  });
  for (const key of toDelete) {
    u.searchParams.delete(key);
  }
  if (!(u.hash.startsWith('#/') || u.hash.startsWith('#!/'))) {
    u.hash = '';
  }
  return u.toString();
}

export function isHttpUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
