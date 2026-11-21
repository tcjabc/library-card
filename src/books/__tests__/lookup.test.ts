import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book, DataStore } from '../../data';
import { BookLookupError, lookupIsbn, providerOrder } from '../lookup';

const TAIWAN = '9789571234564';
const OTHER = '9780439708180';

describe('providerOrder', () => {
  it('tries Google first for Taiwanese prefixes 978957, 978986 and 978626', () => {
    expect(providerOrder('9789570000000')).toEqual(['google', 'openlibrary']);
    expect(providerOrder('9789860000000')).toEqual(['google', 'openlibrary']);
    expect(providerOrder('9786260000000')).toEqual(['google', 'openlibrary']);
  });

  it('tries Open Library first for everything else', () => {
    expect(providerOrder(OTHER)).toEqual(['openlibrary', 'google']);
    expect(providerOrder('9791032305690')).toEqual(['openlibrary', 'google']);
    expect(providerOrder('9789580000000')).toEqual(['openlibrary', 'google']); // 978958 is not Taiwan
  });
});

/** A minimal in-memory stand-in for the two store methods lookup uses. */
function fakeStore(cached: Book | null = null) {
  const saved: Book[] = [];
  const store = {
    getBook: async () => cached,
    putBook: async (book: Book) => {
      saved.push(book);
      return book;
    },
  } as unknown as DataStore;
  return { store, saved };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const openLibrary = (isbn: string, entry: Record<string, unknown> | null) => (entry ? { [`ISBN:${isbn}`]: entry } : {});
const google = (info: Record<string, unknown> | null) => (info ? { totalItems: 1, items: [{ volumeInfo: info }] } : { totalItems: 0 });

/** Routes fetch by host; records the order providers were called in. */
function stubFetch(routes: { openlibrary?: () => Response; google?: () => Response }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('openlibrary.org')) {
        calls.push('openlibrary');
        if (!routes.openlibrary) throw new TypeError('offline');
        return routes.openlibrary();
      }
      if (url.includes('googleapis.com')) {
        calls.push('google');
        if (!routes.google) throw new TypeError('offline');
        return routes.google();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupIsbn', () => {
  it('returns a cached book without calling any provider', async () => {
    const cached: Book = { isbn: OTHER, title: 'Cached', authors: [], cover_url: 'https://x/c.jpg', source: 'manual' };
    const calls = stubFetch({});
    const { store } = fakeStore(cached);
    expect(await lookupIsbn(OTHER, { store })).toEqual(cached);
    expect(calls).toEqual([]);
  });

  it('rejects an invalid ISBN', async () => {
    const { store } = fakeStore();
    await expect(lookupIsbn('123', { store })).rejects.toMatchObject({ code: 'invalid_isbn' });
  });

  it('uses Open Library first, title-cases an all-lowercase title and caches a book with a cover', async () => {
    const calls = stubFetch({
      openlibrary: () => json(openLibrary(OTHER, { title: "harry potter and the sorcerer's stone", authors: [{ name: 'J. K. Rowling' }], cover: {} })),
    });
    const { store, saved } = fakeStore();
    const book = await lookupIsbn(OTHER, { store });
    expect(calls).toEqual(['openlibrary']);
    expect(book).toMatchObject({ title: "Harry Potter and the Sorcerer's Stone", authors: ['J. K. Rowling'], source: 'openlibrary' });
    expect(book?.cover_url).toContain('covers.openlibrary.org/b/isbn/9780439708180-M.jpg');
    expect(saved).toHaveLength(1);
  });

  it('asks Google first for a Taiwanese ISBN', async () => {
    const calls = stubFetch({
      google: () => json(google({ title: '小王子', authors: ['A'], imageLinks: { thumbnail: 'http://books.google.com/x&edge=curl' } })),
    });
    const { store } = fakeStore();
    const book = await lookupIsbn(TAIWAN, { store });
    expect(calls).toEqual(['google']);
    expect(book?.title).toBe('小王子'); // not title-cased
    expect(book?.cover_url).toBe('https://books.google.com/x'); // https, no curl
  });

  it('takes the cover from the second provider when the first has none', async () => {
    const calls = stubFetch({
      openlibrary: () => json(openLibrary(OTHER, { title: 'Found', authors: [] })),
      google: () => json(google({ title: 'Other title', imageLinks: { thumbnail: 'https://books.google.com/c' } })),
    });
    const { store } = fakeStore();
    const book = await lookupIsbn(OTHER, { store });
    expect(calls).toEqual(['openlibrary', 'google']);
    expect(book).toMatchObject({ title: 'Found', source: 'openlibrary', cover_url: 'https://books.google.com/c' });
  });

  it('does not cache a book that has no cover (the add-cover sheet saves it)', async () => {
    stubFetch({ openlibrary: () => json(openLibrary(OTHER, { title: 'No cover' })), google: () => json(google(null)) });
    const { store, saved } = fakeStore();
    expect((await lookupIsbn(OTHER, { store }))?.cover_url).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('returns null when both providers answer and neither knows the book', async () => {
    stubFetch({ openlibrary: () => json({}), google: () => json(google(null)) });
    const { store } = fakeStore();
    expect(await lookupIsbn(OTHER, { store })).toBeNull();
  });

  it('rejects with "network" when the book was not found and a provider failed', async () => {
    stubFetch({ openlibrary: () => json({}), google: () => json({ error: 'rate limited' }, 429) });
    const { store } = fakeStore();
    const error = await lookupIsbn(OTHER, { store }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BookLookupError);
    expect(error).toMatchObject({ code: 'network' });
  });
});
