import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverArt, forgetCoverColours, type CoverWish } from '../coverArt';
import { COLOURS_KEY, FIRST_BACKOFF_MS, MAX_TRIES } from '../coverColour';
import { isTainted } from '../pixelGuard';

/**
 * The cover loader end to end, in node: fetch, <img>, canvases and createImageBitmap are
 * pretend, the timers fake. Regression tests for 1.13.1 (covers that never reached the top face).
 */

const ISBN = '9789571234567';
const GOOGLE = `https://books.google.com/books/content?id=g1&printsec=frontcover&img=1&zoom=1`;
const OL_BY_ISBN = `https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg?default=false&lc-pixels=1`;
const OL = 'https://covers.openlibrary.org/b/isbn/9780000000001-M.jpg?default=false';
const OL_PIXELS = `${OL}&lc-pixels=1`;

/** What each address answers: an HTTP status for fetch (CORS), and whether a plain <img> of it loads. */
let fetchAnswers: Map<string, number[]>;
let imgLoads: Map<string, boolean>;
let fetched: string[];
/** A fetch that takes this long (ms) to answer. */
let fetchDelay: Map<string, number>;
let images: { src: string; crossOrigin: string | null }[];
/** Every pixel read, with whether the canvas read had been marked tainted. */
let reads: { tainted: boolean }[];
let store: Map<string, string>;

class FakeImage {
  crossOrigin: string | null = null;
  decoding = 'auto';
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    images.push({ src: url, crossOrigin: this.crossOrigin });
    setTimeout(() => {
      if (imgLoads.get(url)) {
        this.naturalWidth = 128;
        this.naturalHeight = 190;
        this.onload?.();
      } else this.onerror?.();
    }, 1);
  }
}

function fakeCanvas() {
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const ctx = {
    canvas,
    drawImage: () => {},
    getImageData: () => {
      reads.push({ tainted: isTainted(canvas) });
      // A red cover.
      const data = new Uint8ClampedArray(16 * 16 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 40, 50, 255], i);
      return { data };
    },
  };
  return canvas;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchAnswers = new Map();
  imgLoads = new Map();
  fetched = [];
  fetchDelay = new Map();
  images = [];
  reads = [];
  store = new Map();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  vi.stubGlobal('requestIdleCallback', (cb: (d: { timeRemaining: () => number }) => void) => setTimeout(() => cb({ timeRemaining: () => 50 }), 0));
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  vi.stubGlobal('createImageBitmap', async () => ({ width: 120, height: 180, close: () => {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      const delay = fetchDelay.get(url);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const answers = fetchAnswers.get(url) ?? [404];
      const status = answers.length > 1 ? (answers.shift() as number) : answers[0];
      return { ok: status === 200, status, blob: async () => ({}) };
    }),
  );
  forgetCoverColours();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let the loader's idle slices, fetches and images run. */
async function settle(ms = 200) {
  for (let t = 0; t < ms; t += 10) await vi.advanceTimersByTimeAsync(10);
}

function loader() {
  return new CoverArt({ ink: '#ffffff', onChange: () => {}, shapes: true });
}

function ask(art: CoverArt, wishes: CoverWish[]) {
  art.want({ wishes, drawn: new Set(wishes.map((w) => w.url)), distanceOf: () => 0 });
}

describe('a Google-only cover (no CORS, Open Library has none)', () => {
  it('draws the Google thumbnail from a plain <img> once Open Library answers 404: a tainted picture, no colour', async () => {
    imgLoads.set(GOOGLE, true);
    const art = loader();
    ask(art, [{ url: GOOGLE, isbn: ISBN, picture: true }]);
    await settle();
    expect(fetched).toEqual([OL_BY_ISBN]);
    const picture = art.picture(GOOGLE);
    expect(picture).not.toBeNull();
    expect(picture?.tainted).toBe(true);
    expect(isTainted(picture?.image as object)).toBe(true);
    // No CORS asked for (no crossOrigin attribute), and nothing read from a tainted canvas.
    expect(images.filter((i) => i.src === GOOGLE).every((i) => i.crossOrigin === null)).toBe(true);
    expect(reads.filter((r) => r.tainted)).toEqual([]);
    // The spine keeps the book's own colour; the shape comes from the <img>.
    expect(art.colour(GOOGLE)).toBeNull();
    expect(art.aspect(GOOGLE)).not.toBeNull();
    expect(art.describe(GOOGLE, ISBN)).toMatchObject({ source: 'google', state: 'ready', openLibrary: '404', colour: 'no', shape: true });
  });

  it('with Open Library answering 429: the thumbnail at once, Open Library tried again for the colour after its wait, with the camera at rest', async () => {
    imgLoads.set(GOOGLE, true);
    fetchAnswers.set(OL_BY_ISBN, [429, 200]);
    const art = loader();
    ask(art, [{ url: GOOGLE, isbn: ISBN, picture: true }]);
    await settle();
    expect(art.picture(GOOGLE)?.tainted).toBe(true);
    expect(art.colour(GOOGLE)).toBeNull();
    expect(art.describe(GOOGLE, ISBN)).toMatchObject({ source: 'google', state: 'ready', openLibrary: '429' });
    // No new ask: the wait ends and Open Library is asked again by itself.
    await vi.advanceTimersByTimeAsync(FIRST_BACKOFF_MS);
    await settle();
    expect(fetched.filter((u) => u === OL_BY_ISBN)).toHaveLength(2);
    expect(art.colour(GOOGLE)).not.toBeNull();
    // The colour came from Open Library's (CORS) copy only.
    expect(reads).toHaveLength(1);
    expect(reads[0].tainted).toBe(false);
  });

  it('with no ISBN to ask Open Library by: the thumbnail straight away, no fetch', async () => {
    imgLoads.set(GOOGLE, true);
    const art = loader();
    ask(art, [{ url: GOOGLE, isbn: 'noisbn-1', picture: true }]);
    await settle();
    expect(fetched).toEqual([]);
    expect(art.picture(GOOGLE)?.tainted).toBe(true);
    expect(art.describe(GOOGLE, 'noisbn-1')).toMatchObject({ source: 'google', state: 'ready', openLibrary: 'no ISBN' });
  });

  it('a thumbnail that won’t load backs off and gives up after MAX_TRIES tries a visit', async () => {
    const art = loader();
    ask(art, [{ url: GOOGLE, isbn: ISBN, picture: true }]);
    await settle();
    expect(art.describe(GOOGLE, ISBN)).toMatchObject({ source: 'google', state: 'backoff', attempts: 1, reason: 'image failed' });
    for (let k = 0; k < MAX_TRIES; k++) {
      await vi.advanceTimersByTimeAsync(FIRST_BACKOFF_MS * 2 ** k);
      await settle();
    }
    const tries = images.filter((i) => i.src === GOOGLE).length;
    expect(art.describe(GOOGLE, ISBN)).toMatchObject({ state: 'failed', attempts: MAX_TRIES });
    await vi.advanceTimersByTimeAsync(10 * FIRST_BACKOFF_MS);
    await settle();
    expect(images.filter((i) => i.src === GOOGLE).length).toBe(tries);
    expect(art.picture(GOOGLE)).toBeNull();
  });

  it('only a picture wanted on the top face is loaded from Google (a colour-only wish loads nothing from it)', async () => {
    imgLoads.set(GOOGLE, true);
    const art = loader();
    ask(art, [{ url: GOOGLE, isbn: ISBN, picture: false }]);
    await settle();
    expect(art.picture(GOOGLE)).toBeNull();
    expect(art.describe(GOOGLE, ISBN)).toMatchObject({ source: 'google', state: 'not requested', openLibrary: '404' });
  });
});

describe('an Open Library cover', () => {
  it('gives the spine its colour and the top face its picture (not tainted)', async () => {
    fetchAnswers.set(OL_PIXELS, [200]);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle();
    expect(art.picture(OL)?.tainted).toBeFalsy();
    expect(art.colour(OL)).not.toBeNull();
    expect(reads).toEqual([{ tainted: false }]);
    expect(art.describe(OL, '9780000000001')).toMatchObject({ source: 'openlibrary', state: 'ready', colour: 'yes' });
  });

  it('answering 429 once is tried again when its wait is over, with the camera at rest (1.13.0 waited for the camera to move)', async () => {
    fetchAnswers.set(OL_PIXELS, [429, 200]);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle();
    expect(art.describe(OL, '9780000000001')).toMatchObject({ state: 'backoff', reason: '429', attempts: 1 });
    await vi.advanceTimersByTimeAsync(FIRST_BACKOFF_MS);
    await settle();
    expect(art.picture(OL)).not.toBeNull();
    expect(art.colour(OL)).not.toBeNull();
  });

  it('a 403 or 429 is never final; a 404 is', async () => {
    fetchAnswers.set(OL_PIXELS, [404]);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle();
    expect(art.describe(OL, '9780000000001')).toMatchObject({ state: 'failed', reason: '404', attempts: 1 });
  });

  it('a cover loading for its colour only when its book comes into view still gets its picture, without another ask', async () => {
    fetchAnswers.set(OL_PIXELS, [200]);
    fetchDelay.set(OL_PIXELS, 100);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: false }]);
    await settle(30);
    expect(art.describe(OL, '9780000000001').state).toBe('loading');
    // While it loads, the camera moves onto its book (then rests: no more asks).
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle(300);
    expect(art.picture(OL)).not.toBeNull();
    expect(fetched.filter((u) => u === OL_PIXELS)).toHaveLength(1);
  });

  it('a colour already cached (an earlier version) still loads the picture for the top face', async () => {
    store.set(COLOURS_KEY, JSON.stringify({ v: 1, colours: [[`url:${OL}`, '#c82832']] }));
    forgetCoverColours();
    fetchAnswers.set(OL_PIXELS, [200]);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle();
    expect(art.picture(OL)).not.toBeNull();
    // Its colour was known: no pixels read.
    expect(reads).toEqual([]);
  });

  it('nothing is fetched again after dispose, and no retry wakes it', async () => {
    fetchAnswers.set(OL_PIXELS, [429, 200]);
    const art = loader();
    ask(art, [{ url: OL, isbn: '9780000000001', picture: true }]);
    await settle();
    art.dispose();
    await vi.advanceTimersByTimeAsync(2 * FIRST_BACKOFF_MS);
    expect(fetched).toEqual([OL_PIXELS]);
  });
});
