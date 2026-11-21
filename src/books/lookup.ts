import { getDataStore, type Book, type DataStore } from '../data';
import { isbn13To10, normaliseIsbn } from './isbn';

export { normaliseIsbn } from './isbn';

/**
 * ISBN -> Book. Order: DataStore cache, Open Library, Google Books.
 * Resolves to null if every provider answered and none knows the ISBN.
 * Rejects with a BookLookupError if the input is invalid ("invalid_isbn"), or
 * if the book wasn't found and at least one provider was unreachable
 * ("network"), so the UI can offer a retry instead of "not found".
 */

export type BookLookupErrorCode = 'invalid_isbn' | 'network';

export class BookLookupError extends Error {
  readonly code: BookLookupErrorCode;

  constructor(code: BookLookupErrorCode, message: string) {
    super(message);
    this.name = 'BookLookupError';
    this.code = code;
  }
}

const TIMEOUT_MS = 8000;

interface LookupOptions {
  /** Skip the DataStore cache and refetch. */
  refresh?: boolean;
  /** Defaults to the shared store from getDataStore(). */
  store?: DataStore;
  signal?: AbortSignal;
}

type ProviderResult = Omit<Book, 'isbn'> | null;

export async function lookupIsbn(raw: string, options: LookupOptions = {}): Promise<Book | null> {
  const isbn = normaliseIsbn(raw);
  if (!isbn) throw new BookLookupError('invalid_isbn', `Not a valid ISBN: ${raw}`);

  const store = options.store ?? (await getDataStore());
  if (!options.refresh) {
    const cached = await store.getBook(isbn);
    if (cached) return cached;
  }

  let networkFailures = 0;
  const attempt = async (provider: () => Promise<ProviderResult>): Promise<ProviderResult> => {
    try {
      return await provider();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      networkFailures++;
      console.warn('[lookup] provider failed', error);
      return null;
    }
  };

  let found = await attempt(() => fromOpenLibrary(isbn, options.signal));
  if (!found || !found.cover_url) {
    const google = await attempt(() => fromGoogleBooks(isbn, options.signal));
    if (!found) found = google;
    else if (google?.cover_url) found = { ...found, cover_url: google.cover_url };
  }

  if (!found) {
    if (networkFailures > 0) {
      throw new BookLookupError('network', 'A book provider could not be reached.');
    }
    return null;
  }
  const book: Book = { isbn, ...found };
  // Only cache complete answers. If a provider failed (e.g. Google's 429 rate
  // limit), a later lookup may still find the missing cover.
  if (networkFailures > 0 && !book.cover_url) return book;
  return store.putBook(book);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // AbortSignal.timeout/any are too new for older iOS Safari; do it by hand.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

interface OpenLibraryEntry {
  title?: string;
  subtitle?: string;
  authors?: { name?: string }[];
  cover?: { small?: string; medium?: string; large?: string };
}

async function fromOpenLibrary(isbn: string, signal?: AbortSignal): Promise<ProviderResult> {
  const isbn10 = isbn13To10(isbn);
  const keys = [`ISBN:${isbn}`, ...(isbn10 ? [`ISBN:${isbn10}`] : [])];
  const url =
    `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(keys.join(','))}` +
    '&format=json&jscmd=data';
  const data = (await fetchJson(url, signal)) as Record<string, OpenLibraryEntry> | null;
  const entry = keys.map((key) => data?.[key]).find((e) => e?.title);
  if (!entry?.title) return null;

  return {
    title: joinTitle(entry.title, entry.subtitle),
    authors: (entry.authors ?? []).map((a) => a.name?.trim() ?? '').filter(Boolean),
    // Only point at the cover service when Open Library says a cover exists;
    // with ?default=false it returns 404 instead of a blank placeholder.
    cover_url: entry.cover ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null,
    source: 'openlibrary',
  };
}

interface GoogleBooksResponse {
  totalItems?: number;
  items?: {
    volumeInfo?: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }[];
}

async function fromGoogleBooks(isbn: string, signal?: AbortSignal): Promise<ProviderResult> {
  const params = new URLSearchParams({ q: `isbn:${isbn}`, maxResults: '1' });
  const key = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
  if (key) params.set('key', key);
  const data = (await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
    signal,
  )) as GoogleBooksResponse;
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) return null;

  const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
  return {
    title: joinTitle(info.title, info.subtitle),
    authors: (info.authors ?? []).map((a) => a.trim()).filter(Boolean),
    cover_url: thumb ? thumb.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
    source: 'google',
  };
}

function joinTitle(title: string, subtitle?: string): string {
  const t = title.trim();
  const s = subtitle?.trim();
  return s ? `${t}: ${s}` : t;
}
