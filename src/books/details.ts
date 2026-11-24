import { fetchJson, googleBooksUrl, openLibraryKeys, openLibraryUrl, providerOrder, type ProviderName } from './lookup';

/**
 * "About this book": the web details shown under the family's own data in the Family Staircase's
 * book sheet (src/screens/journeys/BookDetailsSheet.tsx). Looked up by ISBN from the same two
 * providers, in the same order, as lookup.ts (Taiwanese ISBNs: Google Books first; everything
 * else: Open Library first). The second provider only fills the gaps the first one left.
 *
 * Everything from a provider is untrusted: the mappers below accept any JSON, keep only fields of
 * the expected type, and turn descriptions into plain text paragraphs (rendered as text, never
 * as HTML). Links are kept only when they point at the provider's own https site.
 */

/**
 * Google Books' maturity label, kept only when it says "mature" (for grown-ups). NOT_MATURE is
 * Google's default for almost every book, so it (and a missing label) is kept as no rating.
 */
export type AgeRating = 'mature';

export interface BookDetails {
  /** Plain text paragraphs, or empty. */
  description: string[];
  subtitle: string | null;
  publisher: string | null;
  publishYear: number | null;
  pageCount: number | null;
  /** A BCP 47 language code ("en", "zh-TW"), or null. */
  language: string | null;
  ageRating: AgeRating | null;
  /** The provider's page for the book (the provider that found it first). */
  link: { provider: ProviderName; url: string } | null;
}

export const EMPTY_DETAILS: BookDetails = {
  description: [],
  subtitle: null,
  publisher: null,
  publishYear: null,
  pageCount: null,
  language: null,
  ageRating: null,
  link: null,
};

/** True when a provider found nothing worth showing. */
export function isEmptyDetails(d: BookDetails): boolean {
  return (
    d.description.length === 0 &&
    !d.subtitle &&
    !d.publisher &&
    d.publishYear === null &&
    d.pageCount === null &&
    !d.language &&
    !d.ageRating
  );
}

// ---------------------------------------------------------------------------
// Small readers for untrusted JSON
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function positiveInt(v: unknown, max = 100_000): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole > 0 && whole <= max ? whole : null;
}

/** The first plausible year (1450–2100) in a date like "2005", "2005-03-01" or "March 5, 2005". */
export function yearOf(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const match = /(?:^|\D)(1[4-9]\d\d|20\d\d|2100)(?!\d)/.exec(v);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1450 && year <= 2100 ? year : null;
}

/** A BCP 47 language code from "en", "zh-TW", "eng" or Open Library's "/languages/eng". */
export function languageCode(v: unknown): string | null {
  const raw = typeof v === 'string' ? v : isObject(v) && typeof v.key === 'string' ? v.key : null;
  if (!raw) return null;
  const code = raw.trim().replace(/^\/languages\//, '');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) return null;
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
}

/** Only https links on the provider's own site. */
export function safeLink(v: unknown, provider: ProviderName): string | null {
  if (typeof v !== 'string') return null;
  let url: URL;
  try {
    url = new URL(v.trim().replace(/^http:/, 'https:'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const ok =
    provider === 'google'
      ? host === 'books.google.com' || /^books\.google\.[a-z.]+$/.test(host) || host === 'play.google.com'
      : host === 'openlibrary.org' || host.endsWith('.openlibrary.org');
  return ok ? url.toString() : null;
}

// ---------------------------------------------------------------------------
// HTML -> plain paragraphs
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ccedil: 'ç',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Longest description kept (characters), so one book can't fill the device's cache. */
export const MAX_DESCRIPTION = 6000;

/**
 * A description (HTML from Google Books, plain text or Markdown-ish from Open Library) as plain
 * paragraphs: tags dropped (scripts and styles with their contents), line and paragraph breaks
 * kept, entities decoded, white space tidied, empty paragraphs gone.
 */
export function plainParagraphs(input: unknown, max = MAX_DESCRIPTION): string[] {
  if (typeof input !== 'string' || !input.trim()) return [];
  let s = input.replace(/\r\n?/g, '\n');
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|li|ul|ol|h[1-6]|blockquote|section|article|tr|table)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  const paragraphs: string[] = [];
  let total = 0;
  for (const block of s.split(/\n\s*\n|\n(?=\s*[-*•]\s)/)) {
    const p = block.replace(/[^\S\n]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    if (!p) continue;
    if (total + p.length > max) {
      const room = max - total;
      if (room > 40) paragraphs.push(`${p.slice(0, room).trimEnd()}…`);
      break;
    }
    paragraphs.push(p);
    total += p.length;
  }
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Provider responses -> BookDetails
// ---------------------------------------------------------------------------

/** A Google Books volume search answer (q=isbn:…) as details, or null when it holds no book. */
export function fromGoogleVolume(response: unknown): BookDetails | null {
  if (!isObject(response) || !Array.isArray(response.items)) return null;
  const item = response.items.find((i) => isObject(i) && isObject(i.volumeInfo));
  if (!isObject(item) || !isObject(item.volumeInfo)) return null;
  const info = item.volumeInfo;
  const maturity = info.maturityRating;
  const link = safeLink(info.infoLink, 'google') ?? safeLink(info.canonicalVolumeLink, 'google');
  return {
    description: plainParagraphs(info.description),
    subtitle: text(info.subtitle),
    publisher: text(info.publisher, 200),
    publishYear: yearOf(info.publishedDate),
    pageCount: positiveInt(info.pageCount),
    language: languageCode(info.language),
    ageRating: maturity === 'MATURE' ? 'mature' : null,
    link: link ? { provider: 'google', url: link } : null,
  };
}

/** Open Library's description field: a string, or { type, value }. */
function openLibraryText(v: unknown): unknown {
  return isObject(v) ? v.value : v;
}

function firstPublisher(v: unknown): string | null {
  if (!Array.isArray(v)) return text(v, 200);
  for (const p of v) {
    const name = text(isObject(p) ? p.name : p, 200);
    if (name) return name;
  }
  return null;
}

/**
 * An Open Library Books API answer (jscmd=details) for these bibkeys as details, or null when it
 * holds none of them. `workKey` is the edition's work ("/works/OL…W"), whose description is often
 * the only one.
 */
export function fromOpenLibraryDetails(response: unknown, keys: readonly string[]): (BookDetails & { workKey: string | null }) | null {
  if (!isObject(response)) return null;
  const entry = keys.map((k) => response[k]).find((e): e is Json => isObject(e) && isObject(e.details));
  if (!entry || !isObject(entry.details)) return null;
  const d = entry.details;
  const languages = Array.isArray(d.languages) ? d.languages : [];
  const works = Array.isArray(d.works) ? d.works : [];
  const work = works.map((w) => (isObject(w) ? w.key : null)).find((k): k is string => typeof k === 'string' && /^\/works\/OL\d+W$/.test(k));
  const pages = positiveInt(d.number_of_pages) ?? (typeof d.pagination === 'string' ? positiveInt(/\d+/.exec(d.pagination)?.[0]) : null);
  const link = safeLink(entry.info_url, 'openlibrary');
  return {
    description: plainParagraphs(openLibraryText(d.description)),
    subtitle: text(d.subtitle),
    publisher: firstPublisher(d.publishers),
    publishYear: yearOf(d.publish_date),
    pageCount: pages,
    language: languages.map(languageCode).find((c): c is string => !!c) ?? null,
    ageRating: null,
    link: link ? { provider: 'openlibrary', url: link } : null,
    workKey: work ?? null,
  };
}

/** An Open Library work (/works/OL…W.json): its description, if any. */
export function fromOpenLibraryWork(response: unknown): string[] {
  return isObject(response) ? plainParagraphs(openLibraryText(response.description)) : [];
}

/** `first`'s fields, with the gaps filled from `second`. */
export function mergeDetails(first: BookDetails | null, second: BookDetails | null): BookDetails | null {
  if (!first) return second;
  if (!second) return first;
  return {
    description: first.description.length ? first.description : second.description,
    subtitle: first.subtitle ?? second.subtitle,
    publisher: first.publisher ?? second.publisher,
    publishYear: first.publishYear ?? second.publishYear,
    pageCount: first.pageCount ?? second.pageCount,
    language: first.language ?? second.language,
    ageRating: first.ageRating ?? second.ageRating,
    link: first.link ?? second.link,
  };
}

/** True when every field a provider can give is there (no need to ask the other one). */
export function isComplete(d: BookDetails | null): boolean {
  return !!d && d.description.length > 0 && !!d.publisher && d.publishYear !== null && d.pageCount !== null && !!d.language;
}

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

export class BookDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookDetailsError';
  }
}

async function fromGoogle(isbn: string, signal?: AbortSignal): Promise<BookDetails | null> {
  return fromGoogleVolume(await fetchJson(googleBooksUrl(isbn), signal));
}

async function fromOpenLibrary(isbn: string, signal?: AbortSignal): Promise<BookDetails | null> {
  const keys = openLibraryKeys(isbn);
  const found = fromOpenLibraryDetails(await fetchJson(openLibraryUrl(keys, 'details'), signal), keys);
  if (!found) return null;
  const { workKey, ...details } = found;
  if (details.description.length === 0 && workKey) {
    try {
      details.description = fromOpenLibraryWork(await fetchJson(`https://openlibrary.org${workKey}.json`, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      // The edition's details are still worth showing.
    }
  }
  return details;
}

/**
 * The web details for an ISBN-13: the first provider's, with gaps filled from the second. Null
 * when both answered and neither knows the book (or knows nothing more than its title). Rejects
 * with a BookDetailsError when nothing was found and a provider couldn't be reached, and with the
 * abort when `signal` aborts before anything was found; once the first provider has answered,
 * an abort keeps what it found.
 */
export async function fetchBookDetails(isbn: string, signal?: AbortSignal): Promise<BookDetails | null> {
  const providers = { google: fromGoogle, openlibrary: fromOpenLibrary } as const;
  let failures = 0;
  const attempt = async (name: ProviderName): Promise<BookDetails | null> => {
    try {
      return await providers[name](isbn, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      failures++;
      console.warn('[details] provider failed', name, error instanceof Error ? error.message : error);
      return null;
    }
  };
  const [first, second] = providerOrder(isbn);
  let found = await attempt(first);
  if (!isComplete(found)) {
    try {
      found = mergeDetails(found, await attempt(second));
    } catch (error) {
      if (!found) throw error;
    }
  }
  if (found && !isEmptyDetails(found)) return found;
  if (failures > 0) throw new BookDetailsError('A book provider could not be reached.');
  return null;
}
