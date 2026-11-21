import { useSyncExternalStore } from 'react';

/**
 * Minimal hash router. Hash URLs (#/dev) work on static hosts such as
 * GitHub Pages without server rewrites, and inside an installed PWA.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Current path without the leading "#", always starting with "/". */
export function currentPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  const path = raw.split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

/** The query part of a hash URL: "#/grownups/loans?reader=r1" -> reader=r1. */
export function parseHashQuery(hash: string): URLSearchParams {
  const raw = hash.replace(/^#/, '');
  const at = raw.indexOf('?');
  return new URLSearchParams(at === -1 ? '' : raw.slice(at + 1));
}

const currentQuery = () => {
  const at = window.location.hash.indexOf('?');
  return at === -1 ? '' : window.location.hash.slice(at + 1);
};

/** The current hash query; re-renders when it changes. */
export function useHashQuery(): URLSearchParams {
  const query = useSyncExternalStore(subscribe, currentQuery, () => '');
  return new URLSearchParams(query);
}

/** Build an href for an in-app path, e.g. href('/dev') -> "#/dev". */
export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

/** Go to an in-app path. `replace` swaps the history entry (for redirects). */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = href(path);
  if (options.replace) window.location.replace(target);
  else window.location.hash = target;
}

/**
 * Matches "/card/:token" style patterns. Returns params, or null.
 * Params are URI-decoded.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) {
      try {
        params[p[i].slice(1)] = decodeURIComponent(a[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== a[i]) {
      return null;
    }
  }
  return params;
}
