const TRACKING_KEYS = /^(utm_|gclid|fbclid|msclkid|mc_eid)/i;

function isSupportedScheme(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
}

export function canonicalizeUrl(href: string): string {
  const u = new URL(href);
  if (!isSupportedScheme(u.protocol)) {
    throw new Error(`unsupported URL scheme: ${u.protocol}`);
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
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

function protocolOf(href: string): string | undefined {
  try {
    return new URL(href).protocol;
  } catch {
    return undefined;
  }
}

export function isHttpUrl(href: string): boolean {
  const protocol = protocolOf(href);
  return protocol === 'http:' || protocol === 'https:';
}

export function isAnnotatableUrl(href: string): boolean {
  const protocol = protocolOf(href);
  return protocol !== undefined && isSupportedScheme(protocol);
}
