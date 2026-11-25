import { describe, expect, it } from 'vitest';
import { LruCache } from '../canvasHelpers';
import {
  FIRST_BACKOFF_MS,
  MAX_COLOURS,
  MAX_TRIES,
  MIN_CONTRAST,
  PIXELS_PARAM,
  SPINE_LIGHTNESS,
  SPINE_SATURATION,
  afterFailure,
  bitmapSize,
  contrastRatio,
  coverCrop,
  coverKey,
  coverSource,
  dominantColour,
  hslToRgb,
  isFinalStatus,
  isGoogleCover,
  isOpenLibraryCover,
  mayTry,
  parseColours,
  parseHex,
  pixelSource,
  rememberColour,
  rgbToHsl,
  serialiseColours,
  spineColours,
  toHex,
  type Rgb,
} from '../coverColour';

/** RGBA pixels: `n` of each colour given, in order. */
function pixels(...runs: [Rgb | 'clear', number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [colour, n] of runs) {
    for (let i = 0; i < n; i++) {
      if (colour === 'clear') out.push(0, 0, 0, 0);
      else out.push(colour.r, colour.g, colour.b, 255);
    }
  }
  return new Uint8ClampedArray(out);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const GREY: Rgb = { r: 128, g: 128, b: 130 };
const RED: Rgb = { r: 200, g: 30, b: 40 };
const BLUE: Rgb = { r: 30, g: 70, b: 200 };
const GREEN: Rgb = { r: 40, g: 160, b: 60 };
const hue = (hex: string | null) => (hex ? rgbToHsl(parseHex(hex)!).h : NaN);

describe('dominantColour', () => {
  it('a cover of one colour is that colour', () => {
    expect(dominantColour(pixels([RED, 256]))).toBe(toHex(RED));
  });

  it('ignores paper, ink, grey and see-through pixels', () => {
    expect(dominantColour(pixels([WHITE, 140], [BLACK, 60], [GREY, 30], ['clear', 6], [BLUE, 20]))).toBe(toHex(BLUE));
  });

  it('has no colour for a white, black or grey cover (the book keeps its own)', () => {
    expect(dominantColour(pixels([WHITE, 256]))).toBeNull();
    expect(dominantColour(pixels([BLACK, 256]))).toBeNull();
    expect(dominantColour(pixels([GREY, 256]))).toBeNull();
    expect(dominantColour(pixels([WHITE, 120], [BLACK, 130], [GREY, 6]))).toBeNull();
  });

  it('needs enough usable pixels: a speck of colour on white isn’t the cover’s colour', () => {
    expect(dominantColour(pixels([WHITE, 250], [RED, 6]))).toBeNull();
    expect(dominantColour(pixels([WHITE, 240], [RED, 16]))).toBe(toHex(RED));
  });

  it('picks the hue with the most pixels on a cover of several colours', () => {
    expect(hue(dominantColour(pixels([RED, 40], [BLUE, 120], [GREEN, 60], [WHITE, 36])))).toBeCloseTo(rgbToHsl(BLUE).h, 0);
    expect(hue(dominantColour(pixels([GREEN, 100], [RED, 99])))).toBeCloseTo(rgbToHsl(GREEN).h, 0);
  });

  it('averages the winning hue’s shades', () => {
    const dark = { r: 150, g: 20, b: 30 };
    const light = { r: 230, g: 60, b: 70 };
    expect(dominantColour(pixels([dark, 50], [light, 50]))).toBe(toHex({ r: 190, g: 40, b: 50 }));
  });

  it('has nothing for no pixels', () => {
    expect(dominantColour(new Uint8ClampedArray(0))).toBeNull();
    expect(dominantColour(pixels(['clear', 64]))).toBeNull();
  });
});

describe('spineColours: readable white titles', () => {
  const white = { r: 255, g: 255, b: 255 };

  it('keeps every spine readable, whatever the cover', () => {
    for (const colour of ['#ffff00', '#00ff00', '#ffffff', '#f5e6c8', '#00ffff', '#ff8800', '#000000', '#123456', '#7fd0ff']) {
      const c = spineColours(colour)!;
      expect(contrastRatio(parseHex(c.spine)!, white)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('keeps saturation and lightness in their bands, and the hue', () => {
    const c = spineColours('#ff0000')!;
    const hsl = rgbToHsl(parseHex(c.spine)!);
    expect(hsl.h).toBeCloseTo(0, 0);
    expect(hsl.s).toBeLessThanOrEqual(SPINE_SATURATION[1] + 0.01);
    expect(hsl.l).toBeLessThanOrEqual(SPINE_LIGHTNESS[1] + 0.01);
    const dull = rgbToHsl(parseHex(spineColours('#6b6060')!.spine)!);
    expect(dull.s).toBeGreaterThanOrEqual(SPINE_SATURATION[0] - 0.01);
  });

  it('darkens a light colour until the title reads (yellow needs more than blue)', () => {
    const yellow = rgbToHsl(parseHex(spineColours('#ffd700')!.spine)!);
    const blue = rgbToHsl(parseHex(spineColours('#1e46c8')!.spine)!);
    expect(yellow.l).toBeLessThan(blue.l);
  });

  it('the covers’ fill is a little lighter than the spine', () => {
    const c = spineColours('#2a7a3a')!;
    expect(rgbToHsl(parseHex(c.cover)!).l).toBeGreaterThan(rgbToHsl(parseHex(c.spine)!).l);
  });

  it('follows the ink it is checked against, and refuses what isn’t a colour', () => {
    expect(spineColours('#336699', '#000')).not.toBeNull();
    expect(spineColours('blue')).toBeNull();
    expect(spineColours('')).toBeNull();
  });

  it('round-trips colours', () => {
    expect(toHex(hslToRgb(rgbToHsl({ r: 18, g: 52, b: 86 })))).toBe('#123456');
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHex('#12345')).toBeNull();
  });
});

describe('cover keys and where pixels come from', () => {
  const ISBN = '9780439708180';
  const OL = 'https://covers.openlibrary.org/b/isbn/9780439708180-M.jpg?default=false';
  const GOOGLE = 'http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1';

  it('a photo is keyed by its bytes’ hash; a catalogue cover by its address', () => {
    expect(coverKey('blob:http://localhost/1234', 'ab12')).toBe('photo:ab12');
    expect(coverKey('blob:http://localhost/1234')).toBeNull();
    expect(coverKey(OL)).toBe(`url:${OL}`);
    expect(coverKey('cover:abc')).toBeNull();
  });

  it('knows the hosts', () => {
    expect(isOpenLibraryCover(OL)).toBe(true);
    expect(isOpenLibraryCover('https://ia801601.us.archive.org/view_archive.php?x')).toBe(true);
    expect(isOpenLibraryCover('https://archive.org.evil.example/x')).toBe(false);
    expect(isGoogleCover(GOOGLE)).toBe(true);
    expect(isGoogleCover('https://books.google.com.tw/books/content?id=1')).toBe(true);
    expect(isGoogleCover('https://lh3.googleusercontent.com/x')).toBe(true);
    expect(isGoogleCover('not a url')).toBe(false);
  });

  it('reads a photo from itself, an Open Library cover from a copy the service worker’s opaque cache won’t answer', () => {
    expect(pixelSource('blob:http://localhost/1234', ISBN)).toBe('blob:http://localhost/1234');
    expect(pixelSource(OL, ISBN)).toBe(`${OL}&${PIXELS_PARAM}`);
    expect(pixelSource('http://covers.openlibrary.org/b/id/1-M.jpg', ISBN)).toBe(`https://covers.openlibrary.org/b/id/1-M.jpg?${PIXELS_PARAM}`);
  });

  it('a Google cover (no CORS) is read from Open Library’s cover for the ISBN instead, or not at all', () => {
    expect(pixelSource(GOOGLE, ISBN)).toBe(`https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg?default=false&${PIXELS_PARAM}`);
    expect(pixelSource(GOOGLE, 'noisbn-123')).toBeNull();
  });

  it('nothing to read from an address that isn’t http(s)', () => {
    expect(pixelSource('ftp://example.org/x.jpg', ISBN)).toBeNull();
    expect(pixelSource('cover:abc', ISBN)).toBeNull();
  });
});

describe('where the top-face picture comes from: photo > Open Library > Google img > none', () => {
  const ISBN = '9789571234567';
  const OL = `https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg?default=false`;
  const GOOGLE = 'http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1';

  it('a photo from itself', () => {
    expect(coverSource('blob:http://localhost/1234', ISBN)).toEqual({ kind: 'photo', url: 'blob:http://localhost/1234' });
    expect(coverSource('blob:http://localhost/1234', ISBN, true)).toEqual({ kind: 'photo', url: 'blob:http://localhost/1234' });
  });

  it('an Open Library cover through CORS, also after a failure (it backs off and is tried again)', () => {
    expect(coverSource(OL, ISBN)).toEqual({ kind: 'openlibrary', url: `${OL}&${PIXELS_PARAM}` });
    expect(coverSource(OL, ISBN, true)).toEqual({ kind: 'openlibrary', url: `${OL}&${PIXELS_PARAM}` });
  });

  it('a Google cover: Open Library by ISBN first, then the Google thumbnail itself (https) once that is missing or fails', () => {
    expect(coverSource(GOOGLE, ISBN)).toEqual({ kind: 'openlibrary', url: `${OL}&${PIXELS_PARAM}` });
    expect(coverSource(GOOGLE, ISBN, true)).toEqual({ kind: 'google', url: GOOGLE.replace('http:', 'https:') });
  });

  it('a Google cover with no ISBN to ask Open Library by: the thumbnail straight away', () => {
    expect(coverSource(GOOGLE, 'noisbn-123')).toEqual({ kind: 'google', url: GOOGLE.replace('http:', 'https:') });
    expect(coverSource(GOOGLE, '0439708184')).toEqual({ kind: 'google', url: GOOGLE.replace('http:', 'https:') });
  });

  it('any other https cover through CORS; nothing for no cover or another scheme', () => {
    expect(coverSource('https://example.org/c.jpg', ISBN)).toEqual({ kind: 'cors', url: `https://example.org/c.jpg?${PIXELS_PARAM}` });
    expect(coverSource(null, ISBN)).toEqual({ kind: 'none', url: null });
    expect(coverSource('ftp://example.org/x.jpg', ISBN)).toEqual({ kind: 'none', url: null });
    expect(coverSource('cover:abc', ISBN)).toEqual({ kind: 'none', url: null });
  });
});

describe('the cover on the top face', () => {
  it('crops a cover to the face’s shape (cover height along the spine), centred, never stretched', () => {
    // A 2:3 cover on a 230 × 118 book: the face wants width/height = 118/230.
    const c = coverCrop(120, 180, 230, 118);
    expect(c.sh).toBe(180);
    expect(c.sw / c.sh).toBeCloseTo(118 / 230, 6);
    expect(c.sx).toBeCloseTo((120 - c.sw) / 2, 6);
    // A tall, thin cover: crop the height.
    const t = coverCrop(60, 300, 176, 132);
    expect(t.sw).toBe(60);
    expect(t.sw / t.sh).toBeCloseTo(132 / 176, 6);
    expect(t.sy).toBeCloseTo((300 - t.sh) / 2, 6);
  });

  it('copes with nothing to crop', () => {
    expect(coverCrop(0, 0, 230, 118)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });

  it('decodes small: 128 px on the longest side, never bigger than the cover', () => {
    expect(bitmapSize(600, 900)).toEqual({ width: 85, height: 128 });
    expect(bitmapSize(900, 600)).toEqual({ width: 128, height: 85 });
    expect(bitmapSize(60, 90)).toEqual({ width: 60, height: 90 });
    expect(bitmapSize(0, 10)).toEqual({ width: 1, height: 1 });
  });
});

describe('trying again', () => {
  const NOW = 1_000_000;

  it('backs off, doubling, and gives up after MAX_TRIES a visit', () => {
    let a = afterFailure(undefined, NOW, false);
    expect(a).toEqual({ tries: 1, nextAt: NOW + FIRST_BACKOFF_MS, done: false });
    expect(mayTry(a, NOW + 1)).toBe(false);
    expect(mayTry(a, NOW + FIRST_BACKOFF_MS)).toBe(true);
    a = afterFailure(a, NOW + FIRST_BACKOFF_MS, false);
    expect(a.nextAt).toBe(NOW + FIRST_BACKOFF_MS + 2 * FIRST_BACKOFF_MS);
    for (let i = a.tries; i < MAX_TRIES; i++) a = afterFailure(a, NOW, false);
    expect(a.done).toBe(true);
    expect(mayTry(a, Infinity)).toBe(false);
  });

  it('a missing cover is never asked for again this visit', () => {
    const a = afterFailure(undefined, NOW, true);
    expect(a.done).toBe(true);
    expect(mayTry(a, NOW + 10 * FIRST_BACKOFF_MS)).toBe(false);
    expect(mayTry(undefined, NOW)).toBe(true);
  });

  it('404s are final; 403, 408, 429 and 5xx back off', () => {
    expect(isFinalStatus(404)).toBe(true);
    expect(isFinalStatus(410)).toBe(true);
    expect(isFinalStatus(400)).toBe(true);
    for (const status of [403, 408, 429, 500, 502, 503]) expect(isFinalStatus(status)).toBe(false);
  });
});

describe('the colour cache', () => {
  it('round-trips, keeping "no usable colour" too', () => {
    const map = new Map<string, string>();
    rememberColour(map, 'url:a', '#AABBCC');
    rememberColour(map, 'photo:b', null);
    expect(parseColours(serialiseColours(map))).toEqual(new Map([
      ['url:a', '#aabbcc'],
      ['photo:b', ''],
    ]));
  });

  it('keeps at most MAX_COLOURS, the oldest going first; a remembered one moves to the end', () => {
    const map = new Map<string, string>();
    for (let i = 0; i < 5; i++) rememberColour(map, `k${i}`, '#000000', 3);
    expect([...map.keys()]).toEqual(['k2', 'k3', 'k4']);
    rememberColour(map, 'k2', '#111111', 3);
    rememberColour(map, 'k5', '#222222', 3);
    expect([...map.keys()]).toEqual(['k4', 'k2', 'k5']);
    const big = new Map(Array.from({ length: MAX_COLOURS + 10 }, (_, i) => [`k${i}`, '#000000'] as [string, string]));
    expect(parseColours(serialiseColours(big)).size).toBe(MAX_COLOURS);
  });

  it('ignores anything it didn’t write', () => {
    expect(parseColours(null).size).toBe(0);
    expect(parseColours('{nope').size).toBe(0);
    expect(parseColours(JSON.stringify({ v: 2, colours: [['a', '#000000']] })).size).toBe(0);
    expect(parseColours(JSON.stringify({ v: 1, colours: [['a', 'red'], [3, '#000000'], ['b', '#123456']] }))).toEqual(new Map([['b', '#123456']]));
  });
});

describe('LruCache releases what it drops', () => {
  it('tells onEvict about values dropped, replaced, deleted and cleared', () => {
    const gone: string[] = [];
    const cache = new LruCache<string, string>(2, (value, key) => gone.push(`${key}=${value}`));
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a');
    cache.set('c', '3');
    expect(gone).toEqual(['b=2']);
    cache.set('a', '1b');
    expect(gone).toEqual(['b=2', 'a=1']);
    expect(cache.delete('c')).toBe(true);
    expect(cache.delete('missing')).toBe(false);
    expect(cache.keys()).toEqual(['a']);
    cache.clear();
    expect(gone).toEqual(['b=2', 'a=1', 'c=3', 'a=1b']);
    expect(cache.size).toBe(0);
  });

  it('setting the same value again releases nothing', () => {
    const gone: string[] = [];
    const cache = new LruCache<string, string>(2, (value) => gone.push(value));
    cache.set('a', 'x');
    cache.set('a', 'x');
    expect(gone).toEqual([]);
  });
});
