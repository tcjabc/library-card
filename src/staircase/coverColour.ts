/**
 * Real covers on the Family Staircase's books (pure, unit-tested): one colour per cover for the
 * book's spine, where its pixels may be read from, how a cover fits a book's top face, how often
 * a cover that fails is tried again, and the device's colour cache's format. The loading itself
 * is coverArt.ts; the drawing is CanvasStack.tsx.
 */

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: Math.min(1, s), l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return { r: to(r1), g: to(g1), b: to(b1) };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** "#rgb" or "#rrggbb" (any case), or null. */
export function parseHex(text: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pixels lighter than this (HSL lightness) are paper, not colour. */
export const NEAR_WHITE = 0.92;
/** …darker than this are ink. */
export const NEAR_BLACK = 0.08;
/** …and greyer than this (HSL saturation) have no colour worth naming. */
export const GREY = 0.15;
/** Hue buckets (degrees each). */
export const HUE_BUCKET = 30;
/** A cover needs at least this share of usable pixels to have a colour (else the book keeps its own). */
export const MIN_USABLE_SHARE = 0.04;
/** Pixels at least this opaque count. */
const MIN_ALPHA = 128;

/**
 * One colour for a cover from its pixels (RGBA, e.g. a 16 × 16 copy): near-white, near-black,
 * grey and see-through pixels are skipped; the hue bucket with the most pixels (ties: the more
 * saturated) wins, and its pixels' average is the colour. Null when too few pixels are usable.
 */
export function dominantColour(rgba: ArrayLike<number>): string | null {
  const buckets = Math.round(360 / HUE_BUCKET);
  const count = new Array<number>(buckets).fill(0);
  const sat = new Array<number>(buckets).fill(0);
  const sum = Array.from({ length: buckets }, () => ({ r: 0, g: 0, b: 0 }));
  const pixels = Math.floor(rgba.length / 4);
  let usable = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (rgba[i * 4 + 3] < MIN_ALPHA) continue;
    const { h, s, l } = rgbToHsl({ r, g, b });
    if (l > NEAR_WHITE || l < NEAR_BLACK || s < GREY) continue;
    const k = Math.floor(h / HUE_BUCKET) % buckets;
    count[k] += 1;
    sat[k] += s;
    sum[k].r += r;
    sum[k].g += g;
    sum[k].b += b;
    usable += 1;
  }
  if (pixels === 0 || usable === 0 || usable / pixels < MIN_USABLE_SHARE) return null;
  let best = 0;
  for (let k = 1; k < buckets; k++) {
    if (count[k] > count[best] || (count[k] === count[best] && sat[k] > sat[best])) best = k;
  }
  const n = count[best];
  return toHex({ r: sum[best].r / n, g: sum[best].g / n, b: sum[best].b / n });
}

/** The spine's saturation and lightness stay in these bands, so every pile looks of a piece. */
export const SPINE_SATURATION: readonly [number, number] = [0.3, 0.78];
export const SPINE_LIGHTNESS: readonly [number, number] = [0.18, 0.42];
/** The cover (top face, where no picture is drawn) is this much lighter than the spine, as before (36% / 46%). */
export const COVER_LIFT = 0.1;
/** The spine's title must reach this contrast with the ink on it (WCAG AA for text). */
export const MIN_CONTRAST = 4.5;

export interface BookColours {
  /** The spine's fill. */
  spine: string;
  /** The covers' flat fill (top and bottom faces). */
  cover: string;
}

/**
 * A cover's colour made fit for a spine: saturation and lightness clamped to the bands, then
 * darkened until `ink` (the spine's text, white) reads on it. Null for a colour that isn't hex.
 */
export function spineColours(colour: string, ink = '#ffffff'): BookColours | null {
  const rgb = parseHex(colour);
  const inkRgb = parseHex(ink) ?? { r: 255, g: 255, b: 255 };
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const s = Math.min(SPINE_SATURATION[1], Math.max(SPINE_SATURATION[0], hsl.s));
  let l = Math.min(SPINE_LIGHTNESS[1], Math.max(SPINE_LIGHTNESS[0], hsl.l));
  let spine = hslToRgb({ h: hsl.h, s, l });
  while (contrastRatio(spine, inkRgb) < MIN_CONTRAST && l > 0.02) {
    l = Math.max(0, l - 0.02);
    spine = hslToRgb({ h: hsl.h, s, l });
  }
  const cover = hslToRgb({ h: hsl.h, s, l: Math.min(SPINE_LIGHTNESS[1] + COVER_LIFT, l + COVER_LIFT) });
  return { spine: toHex(spine), cover: toHex(cover) };
}

// ---------------------------------------------------------------------------
// Where a cover's pixels come from
// ---------------------------------------------------------------------------

/** A photo taken in the app: a blob: (or data:) URL for this page, from the store. */
export function isPhotoUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/** The colour cache's key: a photo by its bytes' SHA-256 (as the store keeps it), a catalogue cover by its address. */
export function coverKey(url: string, photoHash?: string | null): string | null {
  if (isPhotoUrl(url)) return photoHash ? `photo:${photoHash}` : null;
  return /^https?:\/\//i.test(url) ? `url:${url}` : null;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Open Library's covers (and archive.org, where they redirect) send CORS headers. */
export function isOpenLibraryCover(url: string): boolean {
  const host = hostOf(url);
  return !!host && (host === 'covers.openlibrary.org' || host === 'archive.org' || host.endsWith('.archive.org'));
}

/** Google Books' thumbnails send no CORS headers: their pixels can't be read (or drawn) without tainting the canvas. */
export function isGoogleCover(url: string): boolean {
  const host = hostOf(url);
  return !!host && (host === 'books.google.com' || /^books\.google\.[a-z.]+$/.test(host) || host.endsWith('.googleusercontent.com'));
}

/** Added to a catalogue cover's address for the CORS fetch, so it never meets the service worker's opaque copy (cached for <img>). */
export const PIXELS_PARAM = 'lc-pixels=1';

function withPixelsParam(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + PIXELS_PARAM;
}

/**
 * Where to fetch (with CORS) the pixels of a book's cover, or null when there's nowhere: a photo
 * from its own blob: URL; an Open Library cover from its address; a Google Books cover (no CORS)
 * from Open Library's cover for the same ISBN instead; any other https cover from its address.
 */
export function pixelSource(url: string, isbn: string): string | null {
  if (isPhotoUrl(url)) return url;
  if (!/^https:\/\//i.test(url.replace(/^http:/i, 'https:'))) return null;
  const secure = url.replace(/^http:/i, 'https:');
  if (isGoogleCover(secure)) {
    return /^\d{13}$/.test(isbn) ? withPixelsParam(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`) : null;
  }
  return withPixelsParam(secure);
}

// ---------------------------------------------------------------------------
// The cover on a book's top face
// ---------------------------------------------------------------------------

/**
 * The part of a cover (source px) that fills a top face without stretching (like object-fit:
 * cover). The cover lies as on a real book, front up with its spine towards the reader: the
 * cover's height runs along the book's width (`along`, the spine's length) and its width across
 * the book's depth (`across`).
 */
export function coverCrop(imageWidth: number, imageHeight: number, along: number, across: number): { sx: number; sy: number; sw: number; sh: number } {
  if (!(imageWidth > 0 && imageHeight > 0 && along > 0 && across > 0)) return { sx: 0, sy: 0, sw: Math.max(0, imageWidth), sh: Math.max(0, imageHeight) };
  const want = across / along;
  const have = imageWidth / imageHeight;
  if (have > want) {
    const sw = imageHeight * want;
    return { sx: (imageWidth - sw) / 2, sy: 0, sw, sh: imageHeight };
  }
  const sh = imageWidth / want;
  return { sx: 0, sy: (imageHeight - sh) / 2, sw: imageWidth, sh };
}

/** The decoded cover's longest side (px). */
export const COVER_BITMAP_PX = 128;
/** The colour is read from a copy this small (px a side). */
export const COLOUR_SAMPLE_PX = 16;

/** A cover's size scaled to fit COVER_BITMAP_PX on its longest side (never up). */
export function bitmapSize(width: number, height: number, longest = COVER_BITMAP_PX): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 1, height: 1 };
  const k = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

// ---------------------------------------------------------------------------
// Trying again
// ---------------------------------------------------------------------------

/** A cover is tried at most this many times a visit. */
export const MAX_TRIES = 3;
/** The wait after the first failure (ms); it doubles after each one. */
export const FIRST_BACKOFF_MS = 30_000;

export interface Attempts {
  tries: number;
  /** Not before this time (ms). */
  nextAt: number;
  /** Never again this visit: a missing cover (404), no source, or MAX_TRIES failures. */
  done: boolean;
}

/** A failure: `final` for an answer that won't change (404, no usable source); otherwise wait and back off. */
export function afterFailure(previous: Attempts | undefined, now: number, final: boolean): Attempts {
  const tries = (previous?.tries ?? 0) + 1;
  const done = final || tries >= MAX_TRIES;
  return { tries, nextAt: done ? Infinity : now + FIRST_BACKOFF_MS * 2 ** (tries - 1), done };
}

export function mayTry(attempts: Attempts | undefined, now: number): boolean {
  return !attempts || (!attempts.done && now >= attempts.nextAt);
}

/** An HTTP status that won't change by asking again soon. */
export function isFinalStatus(status: number): boolean {
  return status === 404 || status === 410 || (status >= 400 && status < 500 && status !== 403 && status !== 408 && status !== 429);
}

// ---------------------------------------------------------------------------
// The device's colour cache (localStorage: "library-card:cover-colours")
// ---------------------------------------------------------------------------

export const COLOURS_KEY = 'library-card:cover-colours';
/** At most this many covers' colours are kept (the oldest go first). */
export const MAX_COLOURS = 2000;
const COLOURS_VERSION = 1;

/** A cover's colour ("#rrggbb"), or "" for a cover with no usable colour. */
export type StoredColours = Map<string, string>;

export function parseColours(text: string | null): StoredColours {
  const out: StoredColours = new Map();
  if (!text) return out;
  try {
    const v = JSON.parse(text) as { v?: unknown; colours?: unknown };
    if (v?.v !== COLOURS_VERSION || !Array.isArray(v.colours)) return out;
    for (const entry of v.colours) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue;
      if (entry[1] !== '' && !parseHex(entry[1])) continue;
      out.set(entry[0], entry[1].toLowerCase());
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Oldest first, at most MAX_COLOURS. */
export function serialiseColours(colours: StoredColours, max = MAX_COLOURS): string {
  const entries = [...colours].slice(-max);
  return JSON.stringify({ v: COLOURS_VERSION, colours: entries });
}

/** Keeps a colour (moving it to the newest end) and drops the oldest beyond `max`. */
export function rememberColour(colours: StoredColours, key: string, colour: string | null, max = MAX_COLOURS): void {
  colours.delete(key);
  colours.set(key, colour ?? '');
  while (colours.size > max) colours.delete(colours.keys().next().value as string);
}

// ---------------------------------------------------------------------------
// The device's cover-shape cache (localStorage: "library-card:cover-shapes")
// ---------------------------------------------------------------------------

/**
 * Each cover's shape (width ÷ height, bookShapes.coverAspect), beside the colour cache and keyed
 * the same way (coverKey), so a book is shaped at once on the next visit. A separate key, so the
 * colour cache's entries are untouched: a cover whose shape isn't known yet is just read later.
 */
export const SHAPES_KEY = 'library-card:cover-shapes';
/** At most this many covers' shapes are kept (the oldest go first). */
export const MAX_SHAPES = 2000;
const SHAPES_VERSION = 1;

export type StoredShapes = Map<string, number>;

export function parseShapes(text: string | null): StoredShapes {
  const out: StoredShapes = new Map();
  if (!text) return out;
  try {
    const v = JSON.parse(text) as { v?: unknown; shapes?: unknown };
    if (v?.v !== SHAPES_VERSION || !Array.isArray(v.shapes)) return out;
    for (const entry of v.shapes) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'number') continue;
      if (!(entry[1] > 0) || !Number.isFinite(entry[1])) continue;
      out.set(entry[0], entry[1]);
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Oldest first, at most MAX_SHAPES, to 4 decimal places. */
export function serialiseShapes(shapes: StoredShapes, max = MAX_SHAPES): string {
  const entries = [...shapes].slice(-max).map(([k, a]) => [k, Math.round(a * 10000) / 10000]);
  return JSON.stringify({ v: SHAPES_VERSION, shapes: entries });
}

/** Keeps a shape (moving it to the newest end) and drops the oldest beyond `max`. */
export function rememberShape(shapes: StoredShapes, key: string, aspect: number, max = MAX_SHAPES): void {
  shapes.delete(key);
  shapes.set(key, aspect);
  while (shapes.size > max) shapes.delete(shapes.keys().next().value as string);
}
