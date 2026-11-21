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

/** Build an href for an in-app path, e.g. href('/dev') -> "#/dev". */
export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}
