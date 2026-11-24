import { fetchBookDetails, type BookDetails } from './details';

/**
 * This device's copy of the web details (details.ts), so a book's "About this book" shows at
 * once the next time. Kept in localStorage under the app's own "library-card:" prefix: never
 * synced, never in a backup, not in the records or outbox stores, and cleared with every other
 * app key by Grown-ups → Settings → "Reset this device". One key per book; at most MAX_ENTRIES
 * books (the oldest answers go first), so the cache stays well inside the browser's quota.
 *
 * Only answers are kept: details, or "no provider knows this book" (null). Failures (offline, a
 * timeout, a provider down) are never written, so the next opening asks again.
 */

export const DETAILS_KEY_PREFIX = 'library-card:book-details:';
/** A cached answer older than this is shown, then quietly asked again (ms). */
export const DETAILS_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 300;
const VERSION = 1;

/** The bits of Storage the cache uses (localStorage, or a stand-in in tests). */
export type DetailsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface CachedDetails {
  /** null: the providers answered and don't know the book. */
  details: BookDetails | null;
  /** When it was looked up (ms since the epoch). */
  at: number;
}

export type CacheState = 'missing' | 'fresh' | 'stale';

/** Fresh for DETAILS_FRESH_MS after it was looked up; stale after, or if its time is in the future (a clock moved back). */
export function cacheState(entry: CachedDetails | null, now: number): CacheState {
  if (!entry) return 'missing';
  const age = now - entry.at;
  return age >= 0 && age < DETAILS_FRESH_MS ? 'fresh' : 'stale';
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const maybe = (v: unknown, type: 'string' | 'number') => v === null || typeof v === type;

function isDetails(v: unknown): v is BookDetails {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  const link = d.link as Record<string, unknown> | null;
  return (
    strings(d.description) &&
    maybe(d.subtitle, 'string') &&
    maybe(d.publisher, 'string') &&
    maybe(d.publishYear, 'number') &&
    maybe(d.pageCount, 'number') &&
    maybe(d.language, 'string') &&
    (d.ageRating === null || d.ageRating === 'mature') &&
    (link === null ||
      (typeof link === 'object' && (link.provider === 'google' || link.provider === 'openlibrary') && typeof link.url === 'string'))
  );
}

/** A stored entry, or null if it's missing or not one this version wrote. */
export function parseCached(text: string | null): CachedDetails | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (v?.v !== VERSION || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    if (v.details !== null && !isDetails(v.details)) return null;
    return { details: v.details as BookDetails | null, at: v.at };
  } catch {
    return null;
  }
}

function defaultStorage(): DetailsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCachedDetails(isbn: string, storage: DetailsStorage | null = defaultStorage()): CachedDetails | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(DETAILS_KEY_PREFIX + isbn);
    const entry = parseCached(text);
    // Something this version can't read: drop it, so it's looked up again.
    if (text !== null && !entry) storage.removeItem(DETAILS_KEY_PREFIX + isbn);
    return entry;
  } catch {
    return null;
  }
}

/** Every cached book, oldest answer first. */
function entries(storage: DetailsStorage): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(DETAILS_KEY_PREFIX)) continue;
    out.push({ key, at: parseCached(storage.getItem(key))?.at ?? -Infinity });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Removes the oldest answers until at most `keep` are left. */
export function trimCache(storage: DetailsStorage, keep: number): void {
  const all = entries(storage);
  for (const { key } of all.slice(0, Math.max(0, all.length - keep))) storage.removeItem(key);
}

/**
 * Keeps an answer (details, or null for "not found"). Never call it for a failure. If the browser
 * is out of room, the older half of the cache goes and it tries once more; failing that, nothing
 * is kept (the sheet still shows the answer).
 */
export function writeCachedDetails(isbn: string, details: BookDetails | null, now: number, storage: DetailsStorage | null = defaultStorage()): void {
  if (!storage) return;
  const key = DETAILS_KEY_PREFIX + isbn;
  const text = JSON.stringify({ v: VERSION, at: now, details });
  try {
    const isNew = storage.getItem(key) === null;
    storage.setItem(key, text);
    if (isNew) trimCache(storage, MAX_ENTRIES);
  } catch {
    try {
      trimCache(storage, Math.floor(entries(storage).length / 2));
      storage.setItem(key, text);
    } catch {
      // No room: show it without keeping it.
    }
  }
}

/**
 * Looks the book up (details.fetchBookDetails) and keeps the answer. Only whole answers are kept:
 * not a failure (it rejects, and nothing is written), and not one cut short by `signal` (the
 * timeout), which is still returned for the sheet to show.
 */
export async function lookupDetails(
  isbn: string,
  signal: AbortSignal,
  now: () => number = Date.now,
  storage: DetailsStorage | null = defaultStorage(),
  fetchDetails: typeof fetchBookDetails = fetchBookDetails,
): Promise<BookDetails | null> {
  const details = await fetchDetails(isbn, signal);
  if (!signal.aborted) writeCachedDetails(isbn, details, now(), storage);
  return details;
}
