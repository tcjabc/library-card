import { describe, expect, it } from 'vitest';
import { BookDetailsError, EMPTY_DETAILS, type BookDetails } from '../details';
import {
  DETAILS_FRESH_MS,
  DETAILS_KEY_PREFIX,
  MAX_ENTRIES,
  cacheState,
  lookupDetails,
  parseCached,
  readCachedDetails,
  trimCache,
  writeCachedDetails,
  type DetailsStorage,
} from '../detailsCache';

/** An in-memory Storage; `quota` (characters) makes setItem throw like a full browser. */
function memoryStorage(quota = Infinity): DetailsStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = map.get(k);
      map.set(k, v);
      if (used() > quota) {
        if (before === undefined) map.delete(k);
        else map.set(k, before);
        throw new DOMException('full', 'QuotaExceededError');
      }
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

const ISBN = '9780000000002';
const DETAILS: BookDetails = { ...EMPTY_DETAILS, description: ['Words.'], publisher: 'P', pageCount: 10 };
const NOW = Date.UTC(2026, 10, 24);

describe('cacheState', () => {
  it('is fresh for 30 days, then stale', () => {
    expect(cacheState(null, NOW)).toBe('missing');
    expect(cacheState({ details: DETAILS, at: NOW }, NOW)).toBe('fresh');
    expect(cacheState({ details: DETAILS, at: NOW - DETAILS_FRESH_MS + 1 }, NOW)).toBe('fresh');
    expect(cacheState({ details: DETAILS, at: NOW - DETAILS_FRESH_MS }, NOW)).toBe('stale');
    expect(cacheState({ details: null, at: NOW - 31 * 24 * 3600 * 1000 }, NOW)).toBe('stale');
    // A clock that went backwards: ask again.
    expect(cacheState({ details: DETAILS, at: NOW + 60_000 }, NOW)).toBe('stale');
  });
});

describe('reading and writing', () => {
  it('keeps details and "not found" under the app’s own prefix (cleared by Reset this device)', () => {
    const s = memoryStorage();
    writeCachedDetails(ISBN, DETAILS, NOW, s);
    writeCachedDetails('9780000000019', null, NOW, s);
    expect([...s.map.keys()].every((k) => k.startsWith(DETAILS_KEY_PREFIX) && k.startsWith('library-card:'))).toBe(true);
    expect(readCachedDetails(ISBN, s)).toEqual({ details: DETAILS, at: NOW });
    expect(readCachedDetails('9780000000019', s)).toEqual({ details: null, at: NOW });
    expect(readCachedDetails('9780000000026', s)).toBeNull();
  });

  it('drops an entry it can’t read', () => {
    const s = memoryStorage();
    s.map.set(DETAILS_KEY_PREFIX + ISBN, '{not json');
    expect(readCachedDetails(ISBN, s)).toBeNull();
    expect(s.map.has(DETAILS_KEY_PREFIX + ISBN)).toBe(false);
    expect(parseCached(JSON.stringify({ v: 99, at: NOW, details: null }))).toBeNull();
    expect(parseCached(JSON.stringify({ v: 1, at: 'x', details: null }))).toBeNull();
    expect(parseCached(JSON.stringify({ v: 1, at: NOW, details: { description: 'not a list' } }))).toBeNull();
    expect(parseCached(JSON.stringify({ v: 1, at: NOW, details: { ...DETAILS, link: { provider: 'evil', url: 'x' } } }))).toBeNull();
    // Only "mature" is a rating ("all" was never kept).
    expect(parseCached(JSON.stringify({ v: 1, at: NOW, details: { ...DETAILS, ageRating: 'all' } }))).toBeNull();
    expect(parseCached(JSON.stringify({ v: 1, at: NOW, details: { ...DETAILS, ageRating: 'mature' } }))?.details?.ageRating).toBe('mature');
  });

  it('copes with no storage at all', () => {
    expect(readCachedDetails(ISBN, null)).toBeNull();
    expect(() => writeCachedDetails(ISBN, DETAILS, NOW, null)).not.toThrow();
  });

  it('keeps at most MAX_ENTRIES books, the oldest answers going first', () => {
    const s = memoryStorage();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) writeCachedDetails(String(9780000000000 + i), DETAILS, NOW + i, s);
    expect(s.map.size).toBe(MAX_ENTRIES);
    expect(readCachedDetails('9780000000000', s)).toBeNull();
    expect(readCachedDetails(String(9780000000000 + MAX_ENTRIES + 4), s)).not.toBeNull();
    s.map.set('library-card:something-else', 'kept');
    trimCache(s, 1);
    expect(s.map.get('library-card:something-else')).toBe('kept');
    expect([...s.map.keys()].filter((k) => k.startsWith(DETAILS_KEY_PREFIX))).toHaveLength(1);
  });

  it('makes room when the browser is full, and gives up quietly if it still can’t', () => {
    const one = JSON.stringify({ v: 1, at: NOW, details: DETAILS }).length + DETAILS_KEY_PREFIX.length + 13;
    const s = memoryStorage(one * 4);
    for (let i = 0; i < 4; i++) writeCachedDetails(String(9780000000000 + i), DETAILS, NOW + i, s);
    writeCachedDetails('9780000000099', DETAILS, NOW + 10, s);
    expect(readCachedDetails('9780000000099', s)).not.toBeNull();
    expect(readCachedDetails('9780000000000', s)).toBeNull();
    const tiny = memoryStorage(10);
    expect(() => writeCachedDetails(ISBN, DETAILS, NOW, tiny)).not.toThrow();
    expect(tiny.map.size).toBe(0);
  });
});

describe('lookupDetails: only answers are cached', () => {
  const signal = () => new AbortController().signal;

  it('keeps details, and keeps "not found"', async () => {
    const s = memoryStorage();
    expect(await lookupDetails(ISBN, signal(), () => NOW, s, async () => DETAILS)).toEqual(DETAILS);
    expect(readCachedDetails(ISBN, s)).toEqual({ details: DETAILS, at: NOW });
    expect(await lookupDetails('9780000000019', signal(), () => NOW, s, async () => null)).toBeNull();
    expect(readCachedDetails('9780000000019', s)).toEqual({ details: null, at: NOW });
  });

  it('never caches a failure (offline, a provider down)', async () => {
    const s = memoryStorage();
    await expect(
      lookupDetails(ISBN, signal(), () => NOW, s, async () => {
        throw new BookDetailsError('down');
      }),
    ).rejects.toBeInstanceOf(BookDetailsError);
    expect(s.map.size).toBe(0);
  });

  it('shows but doesn’t keep an answer cut short by the timeout', async () => {
    const s = memoryStorage();
    const controller = new AbortController();
    const got = await lookupDetails(ISBN, controller.signal, () => NOW, s, async () => {
      controller.abort();
      return DETAILS;
    });
    expect(got).toEqual(DETAILS);
    expect(s.map.size).toBe(0);
  });

  it('a later answer replaces an old one (the quiet refresh)', async () => {
    const s = memoryStorage();
    writeCachedDetails(ISBN, null, NOW - DETAILS_FRESH_MS - 1, s);
    expect(cacheState(readCachedDetails(ISBN, s), NOW)).toBe('stale');
    await lookupDetails(ISBN, signal(), () => NOW, s, async () => DETAILS);
    expect(cacheState(readCachedDetails(ISBN, s), NOW)).toBe('fresh');
    expect(readCachedDetails(ISBN, s)?.details).toEqual(DETAILS);
  });
});
