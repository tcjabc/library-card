import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BookDetails } from './details';
import { cacheState, lookupDetails, readCachedDetails } from './detailsCache';

/**
 * The web details for one book, for the Family Staircase's book sheet (`isbn` null: none). A
 * cached answer shows at once. `wanted` lets it ask the providers (the sheet has been open on
 * this book for a moment): nothing is fetched before that. A cached answer older than 30 days is
 * asked again quietly (detailsCache.ts). Otherwise the providers get DETAILS_TIMEOUT_MS between
 * them; offline, or after a failure or the timeout, the sheet shows its friendly message with
 * "Try again" (retry). Failures are never cached.
 */

/** The whole lookup's budget (ms), both providers together. */
export const DETAILS_TIMEOUT_MS = 8000;

export type DetailsStatus =
  /** No book, or the sheet hasn't asked yet. */
  | { kind: 'idle' }
  /** A book without an ISBN (a "noisbn-" key): nothing to look up. */
  | { kind: 'no-isbn' }
  | { kind: 'loading' }
  /** details null: the providers don't know the book. */
  | { kind: 'ready'; details: BookDetails | null }
  /** Offline, a provider couldn't be reached, or the time ran out. */
  | { kind: 'error' };

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

export const hasIsbn = (key: string | null): key is string => !!key && /^\d{13}$/.test(key);

export function useBookDetails(isbn: string | null, wanted: boolean): { status: DetailsStatus; retry: () => void } {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  /** The latest answer or failure, for the book and attempt it belongs to. */
  const [result, setResult] = useState<{ isbn: string; attempt: number; status: DetailsStatus } | null>(null);
  const lookup = hasIsbn(isbn) ? isbn : null;
  // Read once per book (and per "Try again"): a cache hit shows at once.
  const cached = useMemo(() => (lookup ? readCachedDetails(lookup) : null), [lookup, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = !!lookup && wanted && online;
  useEffect(() => {
    if (!active || !lookup) return;
    if (cached && cacheState(cached, Date.now()) === 'fresh') return;
    const quiet = cached !== null;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => controller.abort(), DETAILS_TIMEOUT_MS);
    lookupDetails(lookup, controller.signal).then(
      (details) => {
        if (!cancelled) setResult({ isbn: lookup, attempt, status: { kind: 'ready', details } });
      },
      () => {
        // A quiet refresh that fails keeps showing the cached answer.
        if (!cancelled && !quiet) setResult({ isbn: lookup, attempt, status: { kind: 'error' } });
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, lookup, attempt, cached]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let status: DetailsStatus;
  if (!isbn) status = { kind: 'idle' };
  else if (!lookup) status = { kind: 'no-isbn' };
  else if (result && result.isbn === lookup && result.attempt === attempt) status = result.status;
  else if (cached) status = { kind: 'ready', details: cached.details };
  else if (!online) status = { kind: 'error' };
  else status = { kind: 'loading' };
  return { status, retry };
}
