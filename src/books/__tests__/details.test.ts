import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BookDetailsError,
  EMPTY_DETAILS,
  fetchBookDetails,
  fromGoogleVolume,
  fromOpenLibraryDetails,
  fromOpenLibraryWork,
  isComplete,
  isEmptyDetails,
  languageCode,
  mergeDetails,
  plainParagraphs,
  safeLink,
  yearOf,
  type BookDetails,
} from '../details';

const TAIWAN = '9789571234564';
const OTHER = '9780439708180';
const OL_KEYS = [`ISBN:${OTHER}`, 'ISBN:0439708184'];

const google = (info: unknown) => ({ kind: 'books#volumes', totalItems: 1, items: [{ volumeInfo: info }] });

const FULL_GOOGLE = google({
  title: 'Moon Soup',
  subtitle: 'A Story of Spoons',
  publisher: 'Pretend Press',
  publishedDate: '2019-03-01',
  pageCount: 32,
  language: 'zh-TW',
  maturityRating: 'NOT_MATURE',
  description: '<p>A <b>very</b> small bear makes soup &amp; shares it.</p><p>Then the moon comes out.</p>',
  infoLink: 'http://books.google.com/books?id=abc&source=gbs_api',
  canonicalVolumeLink: 'https://books.google.com/books/about/Moon_Soup.html?id=abc',
});

const FULL_OPEN_LIBRARY = {
  [`ISBN:${OTHER}`]: {
    bib_key: `ISBN:${OTHER}`,
    info_url: 'https://openlibrary.org/books/OL1M/Moon_Soup',
    details: {
      title: 'Moon Soup',
      subtitle: 'A Story of Spoons',
      publishers: ['Pretend Press'],
      publish_date: 'March 1, 2019',
      number_of_pages: 32,
      languages: [{ key: '/languages/eng' }],
      description: { type: '/type/text', value: 'A small bear makes soup.\r\n\r\nThen the moon comes out.' },
      works: [{ key: '/works/OL7W' }],
    },
  },
};

describe('fromGoogleVolume', () => {
  it('maps every field of a full answer', () => {
    expect(fromGoogleVolume(FULL_GOOGLE)).toEqual<BookDetails>({
      description: ['A very small bear makes soup & shares it.', 'Then the moon comes out.'],
      subtitle: 'A Story of Spoons',
      publisher: 'Pretend Press',
      publishYear: 2019,
      pageCount: 32,
      language: 'zh-TW',
      ageRating: null,
      link: { provider: 'google', url: 'https://books.google.com/books?id=abc&source=gbs_api' },
    });
  });

  it('keeps an age rating only when Google says the book is mature', () => {
    expect(fromGoogleVolume(google({ maturityRating: 'MATURE' }))?.ageRating).toBe('mature');
    expect(fromGoogleVolume(google({ maturityRating: 'NOT_MATURE' }))?.ageRating).toBeNull();
    expect(fromGoogleVolume(google({}))?.ageRating).toBeNull();
    expect(fromGoogleVolume(google({ maturityRating: 'mature' }))?.ageRating).toBeNull();
    // A NOT_MATURE label alone is nothing to show.
    expect(isEmptyDetails(fromGoogleVolume(google({ title: 'Pip', maturityRating: 'NOT_MATURE' }))!)).toBe(true);
  });

  it('leaves out missing fields and ignores odd types', () => {
    const d = fromGoogleVolume(
      google({ title: 'Pip', subtitle: 42, publisher: ['x'], publishedDate: 'sometime', pageCount: 0, language: 7, maturityRating: 'WHAT', description: null, infoLink: 'javascript:alert(1)' }),
    );
    expect(d).toEqual({ ...EMPTY_DETAILS });
    expect(fromGoogleVolume(google({ pageCount: '120', maturityRating: 'MATURE', publishedDate: '1999' }))).toMatchObject({
      pageCount: 120,
      ageRating: 'mature',
      publishYear: 1999,
    });
  });

  it('is null for an empty answer or nonsense', () => {
    expect(fromGoogleVolume({ kind: 'books#volumes', totalItems: 0 })).toBeNull();
    expect(fromGoogleVolume({ items: [] })).toBeNull();
    expect(fromGoogleVolume({ items: ['x', null, 3] })).toBeNull();
    expect(fromGoogleVolume(null)).toBeNull();
    expect(fromGoogleVolume('oops')).toBeNull();
    expect(fromGoogleVolume([])).toBeNull();
  });

  it('keeps only links to Google Books, over https', () => {
    expect(fromGoogleVolume(google({ infoLink: 'https://evil.example/books' }))?.link).toBeNull();
    expect(fromGoogleVolume(google({ infoLink: 'https://evil.example', canonicalVolumeLink: 'https://books.google.com/x' }))?.link?.url).toBe('https://books.google.com/x');
    expect(fromGoogleVolume(google({ infoLink: 'https://books.google.com.tw/books?id=1' }))?.link?.url).toBe('https://books.google.com.tw/books?id=1');
  });
});

describe('fromOpenLibraryDetails', () => {
  it('maps every field of a full answer, with the work for later', () => {
    expect(fromOpenLibraryDetails(FULL_OPEN_LIBRARY, OL_KEYS)).toEqual({
      description: ['A small bear makes soup.', 'Then the moon comes out.'],
      subtitle: 'A Story of Spoons',
      publisher: 'Pretend Press',
      publishYear: 2019,
      pageCount: 32,
      language: 'en',
      ageRating: null,
      link: { provider: 'openlibrary', url: 'https://openlibrary.org/books/OL1M/Moon_Soup' },
      workKey: '/works/OL7W',
    });
  });

  it('finds the book under its ISBN-10 key, reads publisher objects and pagination', () => {
    const d = fromOpenLibraryDetails(
      { 'ISBN:0439708184': { details: { publishers: [{ name: 'Name Press' }], pagination: 'xii, 210 p.', description: 'Plain.', languages: ['nonsense', { key: '/languages/chi' }] } } },
      OL_KEYS,
    );
    expect(d).toMatchObject({ publisher: 'Name Press', pageCount: 210, description: ['Plain.'], language: 'zh', workKey: null });
  });

  it('is null when none of the keys has details', () => {
    expect(fromOpenLibraryDetails({}, OL_KEYS)).toBeNull();
    expect(fromOpenLibraryDetails({ [`ISBN:${OTHER}`]: { details: 'nope' } }, OL_KEYS)).toBeNull();
    expect(fromOpenLibraryDetails([], OL_KEYS)).toBeNull();
    expect(fromOpenLibraryDetails(null, OL_KEYS)).toBeNull();
  });

  it('ignores odd types and a bad work key', () => {
    const d = fromOpenLibraryDetails({ [`ISBN:${OTHER}`]: { info_url: 'http://openlibrary.org/books/OL1M', details: { number_of_pages: -3, publish_date: 12, works: [{ key: '/authors/OL1A' }], languages: 'eng' } } }, OL_KEYS);
    expect(d).toMatchObject({ pageCount: null, publishYear: null, workKey: null, language: null });
    expect(d?.link?.url).toBe('https://openlibrary.org/books/OL1M');
  });

  it('reads a work’s description', () => {
    expect(fromOpenLibraryWork({ description: { value: 'From the work.' } })).toEqual(['From the work.']);
    expect(fromOpenLibraryWork({ description: 'Also plain.' })).toEqual(['Also plain.']);
    expect(fromOpenLibraryWork({})).toEqual([]);
    expect(fromOpenLibraryWork('x')).toEqual([]);
  });
});

describe('plainParagraphs (HTML to plain text)', () => {
  it('drops tags, keeps paragraphs and line breaks, decodes entities', () => {
    expect(plainParagraphs('<p>One &lt;two&gt; &quot;three&quot; &#39;four&#39; &#x1F600; caf&eacute;</p><p>Second<br>line</p>')).toEqual([
      'One <two> "three" \'four\' 😀 café',
      'Second line',
    ]);
  });

  it('removes scripts, styles and comments with their contents', () => {
    expect(plainParagraphs('Hi<script>alert(1)</script><style>p{}</style><!-- secret --> there <img src=x onerror=alert(1)>')).toEqual(['Hi there']);
  });

  it('splits on blank lines and list items, tidies white space, drops empty paragraphs', () => {
    expect(plainParagraphs('  A  lot   of\tspace \n\n\n  <ul><li>First</li><li>Second</li></ul>\n- dash item')).toEqual(['A lot of space', 'First', 'Second', '- dash item']);
    expect(plainParagraphs('<p></p><div> </div>')).toEqual([]);
  });

  it('leaves a lone < and unknown entities as they are', () => {
    expect(plainParagraphs('3 < 5 &bogus; &#0; &#xD800;')).toEqual(['3 < 5 &bogus;']);
  });

  it('is empty for nothing or the wrong type', () => {
    expect(plainParagraphs('')).toEqual([]);
    expect(plainParagraphs('   ')).toEqual([]);
    expect(plainParagraphs(null)).toEqual([]);
    expect(plainParagraphs({ value: 'x' })).toEqual([]);
  });

  it('cuts a very long description short', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`).join('\n\n');
    const out = plainParagraphs(long, 1000);
    expect(out.join('').length).toBeLessThanOrEqual(1001);
    expect(out[out.length - 1].endsWith('…')).toBe(true);
  });
});

describe('small readers', () => {
  it('finds a year', () => {
    expect(yearOf('2005')).toBe(2005);
    expect(yearOf('2005-03-01')).toBe(2005);
    expect(yearOf('March 5, 1998')).toBe(1998);
    expect(yearOf('c1987.')).toBe(1987);
    expect(yearOf('12345')).toBeNull();
    expect(yearOf('n.d.')).toBeNull();
    expect(yearOf(2005)).toBeNull();
  });

  it('turns language codes into BCP 47', () => {
    expect(languageCode('en')).toBe('en');
    expect(languageCode('zh-TW')).toBe('zh-TW');
    expect(languageCode('/languages/fre')).toBe('fr');
    expect(languageCode({ key: '/languages/jpn' })).toBe('ja');
    expect(languageCode('not a language')).toBeNull();
    expect(languageCode(3)).toBeNull();
  });

  it('keeps only https links on the provider’s own site', () => {
    expect(safeLink('https://openlibrary.org/books/OL1M', 'openlibrary')).toBe('https://openlibrary.org/books/OL1M');
    expect(safeLink('https://openlibrary.org.evil.example/x', 'openlibrary')).toBeNull();
    expect(safeLink('https://openlibrary.org/x', 'google')).toBeNull();
    expect(safeLink('ftp://books.google.com/x', 'google')).toBeNull();
    expect(safeLink('not a url', 'google')).toBeNull();
  });
});

describe('mergeDetails', () => {
  const first: BookDetails = { ...EMPTY_DETAILS, description: ['From the first.'], publisher: 'First Press', link: { provider: 'google', url: 'https://books.google.com/a' } };
  const second: BookDetails = {
    ...EMPTY_DETAILS,
    description: ['From the second.'],
    publisher: 'Second Press',
    pageCount: 40,
    language: 'en',
    link: { provider: 'openlibrary', url: 'https://openlibrary.org/b' },
  };

  it('keeps the first provider’s fields and fills the gaps from the second', () => {
    expect(mergeDetails(first, second)).toEqual({ ...first, pageCount: 40, language: 'en' });
  });

  it('copes with either missing', () => {
    expect(mergeDetails(null, second)).toBe(second);
    expect(mergeDetails(first, null)).toBe(first);
    expect(mergeDetails(null, null)).toBeNull();
  });

  it('knows when nothing is left to fill', () => {
    expect(isComplete(fromGoogleVolume(FULL_GOOGLE))).toBe(true);
    expect(isComplete(first)).toBe(false);
    expect(isComplete(null)).toBe(false);
  });
});

/** Routes fetch by host; records the order providers were called in. */
function stubFetch(routes: { openlibrary?: unknown; work?: unknown; google?: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = String(input);
      const name = url.includes('/works/') ? 'work' : url.includes('openlibrary.org') ? 'openlibrary' : url.includes('googleapis.com') ? 'google' : 'other';
      calls.push(name);
      const body = routes[name as keyof typeof routes];
      if (body === undefined) throw new TypeError('offline');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

describe('fetchBookDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks Google Books first for a Taiwanese ISBN, and stops when it has everything', async () => {
    const calls = stubFetch({ google: FULL_GOOGLE, openlibrary: {} });
    const d = await fetchBookDetails(TAIWAN);
    expect(calls).toEqual(['google']);
    expect(d?.link?.provider).toBe('google');
  });

  it('asks Open Library first for other ISBNs, then fills the gaps from Google Books', async () => {
    const partial = { [`ISBN:${OTHER}`]: { info_url: 'https://openlibrary.org/books/OL1M', details: { publishers: ['OL Press'], description: 'From OL.' } } };
    const calls = stubFetch({ openlibrary: partial, google: FULL_GOOGLE });
    const d = await fetchBookDetails(OTHER);
    expect(calls).toEqual(['openlibrary', 'google']);
    expect(d).toMatchObject({ publisher: 'OL Press', description: ['From OL.'], pageCount: 32, language: 'zh-TW', link: { provider: 'openlibrary' } });
  });

  it('reads the work’s description when the edition has none', async () => {
    const edition = { [`ISBN:${OTHER}`]: { details: { publishers: ['P'], works: [{ key: '/works/OL7W' }] } } };
    const calls = stubFetch({ openlibrary: edition, work: { description: 'Work words.' }, google: { totalItems: 0 } });
    const d = await fetchBookDetails(OTHER);
    expect(calls).toEqual(['openlibrary', 'work', 'google']);
    expect(d?.description).toEqual(['Work words.']);
  });

  it('is null when both answer and neither knows the book', async () => {
    stubFetch({ openlibrary: {}, google: { totalItems: 0 } });
    expect(await fetchBookDetails(OTHER)).toBeNull();
  });

  it('is null when all they know is a title (nothing more to show)', async () => {
    stubFetch({ openlibrary: {}, google: google({ title: 'Only a title' }) });
    expect(await fetchBookDetails(OTHER)).toBeNull();
  });

  it('keeps what one provider found when the other can’t be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ openlibrary: FULL_OPEN_LIBRARY });
    const d = await fetchBookDetails(OTHER);
    expect(d?.publisher).toBe('Pretend Press');
  });

  it('rejects when nothing was found and a provider couldn’t be reached (offline)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ openlibrary: {} });
    await expect(fetchBookDetails(OTHER)).rejects.toBeInstanceOf(BookDetailsError);
    stubFetch({});
    await expect(fetchBookDetails(TAIWAN)).rejects.toBeInstanceOf(BookDetailsError);
  });

  it('rejects when aborted before anything was found', async () => {
    stubFetch({ openlibrary: {}, google: FULL_GOOGLE });
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBookDetails(OTHER, controller.signal)).rejects.toThrow();
  });
});
