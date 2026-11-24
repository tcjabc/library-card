import {
  COLOUR_SAMPLE_PX,
  COLOURS_KEY,
  SHAPES_KEY,
  afterFailure,
  bitmapSize,
  coverKey,
  dominantColour,
  isFinalStatus,
  isGoogleCover,
  isPhotoUrl,
  mayTry,
  parseColours,
  parseShapes,
  pixelSource,
  rememberColour,
  rememberShape,
  serialiseColours,
  serialiseShapes,
  spineColours,
  type Attempts,
  type BookColours,
  type StoredColours,
  type StoredShapes,
} from './coverColour';
import { coverAspect } from './bookShapes';
import { evictions, fadeProgress, fadeStart, sliceHasRoom, worthKeeping } from './coverPlan';

/**
 * Loads the Family Staircase's real covers, away from the draw loop (CanvasStack asks for the
 * books near the camera in coverPlan.coverJobs' order; this fetches and decodes them, measures
 * them in idle time, then asks for a redraw). Two things per cover:
 *
 * - its colour, for the spine: read from a 16 × 16 copy, kept for every cover in the device's
 *   colour cache (localStorage "library-card:cover-colours": never synced or backed up, cleared
 *   by "Reset this device"), so the next visit has it at once;
 * - a small picture (about 128 px on its longest side) for the top faces, about PICTURE_CAP of
 *   them, released only beyond KEEP_DISTANCE from the camera once over the cap (coverPlan.evictions).
 *
 * - with `shapes`, its shape (width ÷ height, bookShapes.ts), for the book's footprint: from the
 *   bitmap decoded for the colour, or (a Google Books cover, which sends no CORS headers) the
 *   natural size of a plain <img> of the cover itself, never drawn anywhere; kept in the device's
 *   shape cache (localStorage "library-card:cover-shapes", beside the colours).
 *
 * Pixels only ever come through CORS (coverColour.pixelSource) or the app's own photos (blob:
 * URLs), so neither the small canvases nor the pile's canvas is ever tainted. A cover that fails
 * is tried again later, a few times a visit at most (coverColour.afterFailure). A cover arriving
 * for a book on screen fades in (coverPlan.fadeStart); the pile draws the fade.
 */

/** Covers loading at once. */
const CONCURRENT = 2;
/** Covers measured (drawn small, colour read) in one idle slice at most. */
const MEASURES_PER_SLICE = 2;
/** Stored colours turned into spine colours in one idle slice at most (cheap: arithmetic). */
const TINTS_PER_SLICE = 40;
/** Without requestIdleCallback (Safari): a slice just after a frame, of at most this long (ms). */
const FALLBACK_SLICE_MS = 6;
/** The colour cache is written this long after the last new colour (ms). */
const SAVE_AFTER_MS = 1000;

export interface CoverPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** A book the pile would like covered: `picture` when its top face may show it soon. */
export interface CoverWish {
  url: string;
  isbn: string;
  picture: boolean;
}

/** What the pile asks for after a frame. */
export interface CoverAsk {
  /** Most wanted first (coverPlan.coverJobs). */
  wishes: readonly CoverWish[];
  /** The covers of the books drawn now (never released; a cover arriving for one fades in). */
  drawn: ReadonlySet<string>;
  /** A cover's nearest book's distance from the camera (books), Infinity if it's not in the pile. */
  distanceOf: (url: string) => number;
}

// The device's colour cache, read once per page and shared by every pile.
let stored: StoredColours | null = null;
let saveTimer = 0;

function colours(): StoredColours {
  if (!stored) {
    let text: string | null;
    try {
      text = window.localStorage.getItem(COLOURS_KEY);
    } catch {
      text = null;
    }
    stored = parseColours(text);
  }
  return stored;
}

function saveSoon(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      if (stored) window.localStorage.setItem(COLOURS_KEY, serialiseColours(stored));
    } catch {
      // No room or no storage: the colours are kept for this visit only.
    }
  }, SAVE_AFTER_MS);
}

let storedShapes: StoredShapes | null = null;
let shapesTimer = 0;

function shapes(): StoredShapes {
  if (!storedShapes) {
    let text: string | null;
    try {
      text = window.localStorage.getItem(SHAPES_KEY);
    } catch {
      text = null;
    }
    storedShapes = parseShapes(text);
  }
  return storedShapes;
}

function saveShapesSoon(): void {
  window.clearTimeout(shapesTimer);
  shapesTimer = window.setTimeout(() => {
    try {
      if (storedShapes) window.localStorage.setItem(SHAPES_KEY, serialiseShapes(storedShapes));
    } catch {
      // No room or no storage: the shapes are kept for this visit only.
    }
  }, SAVE_AFTER_MS);
}

/** Forget this page's copies (tests, or after "Reset this device" cleared the stored ones). */
export function forgetCoverColours(): void {
  stored = null;
  storedShapes = null;
}

/** A cover's natural size from a plain <img> (no CORS needed, never drawn), or null if it won't load. */
function naturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function release(picture: CoverPicture): void {
  const image = picture.image as { close?: () => void; width?: number; height?: number };
  if (typeof image.close === 'function') image.close();
  else if (typeof HTMLCanvasElement !== 'undefined' && picture.image instanceof HTMLCanvasElement) {
    picture.image.width = 0;
    picture.image.height = 0;
  }
}

async function sha256(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  done: () => void;
}

/** A blob as something drawable, by createImageBitmap (decoded off the main thread) or an <img> of its own blob: URL. */
async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

type Slice = (timeRemaining: () => number) => void;
type IdleCallback = (cb: (deadline: { timeRemaining: () => number }) => void, opts?: { timeout: number }) => number;

/** Run `fn` in idle time: requestIdleCallback, or (Safari) a short slice just after the next frame. */
function idle(fn: Slice): void {
  const ric = (window as { requestIdleCallback?: IdleCallback }).requestIdleCallback;
  if (ric) {
    ric((deadline) => fn(() => deadline.timeRemaining()), { timeout: 300 });
    return;
  }
  const later = () =>
    window.setTimeout(() => {
      const started = performance.now();
      fn(() => FALLBACK_SLICE_MS - (performance.now() - started));
    }, 0);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
  else later();
}

/** A cover fetched and decoded, waiting for an idle slice to be measured. */
interface Measure {
  wish: CoverWish;
  key: string;
  decoded: Decoded;
}

interface Kept {
  picture: CoverPicture;
  used: number;
}

/** When a cover's colour, picture and shape started fading in (performance.now()). */
interface Fade {
  colour?: number;
  picture?: number;
  shape?: number;
}

export interface CoverFade {
  colour: number;
  picture: number;
  /** How far the book's footprint has eased to its cover's shape. */
  shape: number;
}

const FADED: CoverFade = { colour: 1, picture: 1, shape: 1 };

export class CoverArt {
  /** Cover URL -> colour cache key (a photo's needs its bytes hashed first). */
  private readonly keys = new Map<string, string | null>();
  /** Colour cache key -> spine colours for this ink (null: no usable colour). */
  private readonly tints = new Map<string, BookColours | null>();
  private readonly pictures = new Map<string, Kept>();
  private readonly attempts = new Map<string, Attempts>();
  /** Shape reads fail and back off on their own (a Google cover's <img> is a different fetch). */
  private readonly shapeAttempts = new Map<string, Attempts>();
  private readonly loading = new Set<string>();
  /** Covers fetched and decoded, waiting to be measured (not fetched again meanwhile). */
  private readonly arrived = new Set<string>();
  private readonly fades = new Map<string, Fade>();
  private measures: Measure[] = [];
  private queue: readonly CoverWish[] = [];
  /** Where the next look for work in `queue` starts (everything before it is taken or not needed now). */
  private cursor = 0;
  private tintCursor = 0;
  private drawn: ReadonlySet<string> = new Set();
  private distanceOf: (url: string) => number = () => Infinity;
  private used = 0;
  private pumping = false;
  private changed = false;
  private disposed = false;
  private readonly ink: string;
  private readonly onChange: () => void;
  private readonly reduced: () => boolean;
  private readonly fadeMs: number;
  private readonly wantShapes: boolean;

  constructor(options: { ink: string; onChange: () => void; reduced?: () => boolean; fadeMs?: number; shapes?: boolean }) {
    this.ink = options.ink;
    this.onChange = options.onChange;
    this.reduced = options.reduced ?? (() => false);
    this.fadeMs = options.fadeMs ?? 0;
    this.wantShapes = options.shapes ?? false;
  }

  /** The cover's shape (width ÷ height), if known on this device (a lookup). */
  aspect(url: string | null): number | null {
    if (!url) return null;
    const key = this.keyOf(url);
    return key ? (shapes().get(key) ?? null) : null;
  }

  /** The spine colours for a cover, if known (a lookup, or a little arithmetic once). */
  colour(url: string | null): BookColours | null {
    if (!url) return null;
    const key = this.keys.get(url) ?? (isPhotoUrl(url) ? null : coverKey(url));
    if (!key) return null;
    let tint = this.tints.get(key);
    if (tint === undefined) {
      const raw = colours().get(key);
      if (raw === undefined) return null;
      tint = raw ? spineColours(raw, this.ink) : null;
      this.tints.set(key, tint);
    }
    return tint;
  }

  /** The cover's small picture, if decoded (a lookup). */
  picture(url: string | null): CoverPicture | null {
    if (!url) return null;
    const kept = this.pictures.get(url);
    if (!kept) return null;
    kept.used = ++this.used;
    return kept.picture;
  }

  /** How far the cover's colour and picture have faded in (0–1 each; 1 when there's no fade). */
  fade(url: string | null, now: number): CoverFade {
    const f = url ? this.fades.get(url) : undefined;
    if (!url || !f) return FADED;
    const reduced = this.reduced();
    const colour = fadeProgress(f.colour, now, this.fadeMs, reduced);
    const picture = fadeProgress(f.picture, now, this.fadeMs, reduced);
    const shape = fadeProgress(f.shape, now, this.fadeMs, reduced);
    if (colour >= 1 && picture >= 1 && shape >= 1) {
      this.fades.delete(url);
      return FADED;
    }
    return { colour, picture, shape };
  }

  /** Pictures kept and their memory (bytes, 4 a pixel), for the developer tools. */
  stats(): { pictures: number; bytes: number } {
    let bytes = 0;
    for (const { picture } of this.pictures.values()) bytes += picture.width * picture.height * 4;
    return { pictures: this.pictures.size, bytes };
  }

  /**
   * The books near the camera, most wanted first. Replaces what was asked before; pictures are
   * released by coverPlan.evictions. Loading and measuring happen later, in idle time.
   */
  want(ask: CoverAsk): void {
    if (this.disposed) return;
    this.queue = ask.wishes;
    this.cursor = 0;
    this.tintCursor = 0;
    this.drawn = ask.drawn;
    this.distanceOf = ask.distanceOf;
    this.trim();
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const m of this.measures) m.decoded.done();
    this.measures = [];
    this.arrived.clear();
    for (const { picture } of this.pictures.values()) release(picture);
    this.pictures.clear();
    this.fades.clear();
  }

  private trim(): void {
    const gone = evictions(
      Array.from(this.pictures, ([key, kept]) => ({ key, distance: this.distanceOf(key), drawn: this.drawn.has(key), used: kept.used })),
    );
    for (const key of gone) {
      const kept = this.pictures.get(key);
      if (kept) release(kept.picture);
      this.pictures.delete(key);
      this.fades.delete(key);
    }
  }

  private keyOf(url: string): string | null | undefined {
    return this.keys.get(url) ?? (isPhotoUrl(url) ? undefined : coverKey(url));
  }

  private needsPixels(w: CoverWish, key: string | null | undefined): boolean {
    if (!mayTry(this.attempts.get(w.url), Date.now())) return false;
    const known = key ? colours().has(key) : false;
    return !known || (w.picture && !this.pictures.has(w.url) && worthKeeping(this.distanceOf(w.url)));
  }

  private needsShape(w: CoverWish, key: string | null | undefined): boolean {
    if (!this.wantShapes || !mayTry(this.shapeAttempts.get(w.url), Date.now())) return false;
    return !(key && shapes().has(key));
  }

  private needs(w: CoverWish): boolean {
    if (this.loading.has(w.url) || this.arrived.has(w.url)) return false;
    const key = this.keyOf(w.url);
    return this.needsPixels(w, key) || this.needsShape(w, key);
  }

  /** A cover's shape is known: kept, and eased in if its book is on screen. */
  private gotShape(url: string, key: string, width: number, height: number): void {
    const aspect = coverAspect(width, height);
    if (aspect === null) {
      this.shapeAttempts.set(url, afterFailure(undefined, Date.now(), true));
      return;
    }
    rememberShape(shapes(), key, aspect);
    saveShapesSoon();
    this.startFade(url, 'shape');
    this.note(url);
  }

  private pump(): void {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    idle((timeRemaining) => {
      this.pumping = false;
      if (this.disposed) return;
      // 1. Measure what has arrived: a couple a slice, and only while the slice has time.
      for (let n = 0; this.measures.length > 0 && sliceHasRoom(n, MEASURES_PER_SLICE, timeRemaining()); n++) {
        this.measure(this.measures.shift() as Measure);
      }
      // 2. Spine colours already stored on this device, made ready before their books come into view.
      for (let n = 0; this.tintCursor < this.queue.length && sliceHasRoom(n, TINTS_PER_SLICE, timeRemaining()); this.tintCursor++) {
        const url = this.queue[this.tintCursor].url;
        const key = this.keyOf(url);
        if (key && !this.tints.has(key) && colours().has(key)) {
          this.colour(url);
          n++;
        }
      }
      // 3. Start loading the next covers, two at a time.
      while (this.loading.size < CONCURRENT && this.cursor < this.queue.length) {
        const w = this.queue[this.cursor++];
        if (!this.needs(w)) continue;
        this.loading.add(w.url);
        void this.load(w).finally(() => {
          this.loading.delete(w.url);
          this.pump();
        });
      }
      if (this.measures.length > 0 || this.tintCursor < this.queue.length) this.pump();
    });
  }

  /** A cover arrived: draw again if its book is on screen (one off screen is drawn when it comes into view). */
  private note(url: string): void {
    if (this.changed || !this.drawn.has(url)) return;
    this.changed = true;
    window.setTimeout(() => {
      this.changed = false;
      if (!this.disposed) this.onChange();
    }, 0);
  }

  private startFade(url: string, part: keyof Fade): void {
    const at = fadeStart(this.drawn.has(url), this.reduced(), performance.now());
    if (at === undefined) return;
    const f = this.fades.get(url) ?? {};
    f[part] = at;
    this.fades.set(url, f);
  }

  /** Fetch and decode (no drawing here: that waits for an idle slice, in measure()). */
  private async load(w: CoverWish): Promise<void> {
    try {
      let blob: Blob | null = null;
      let key = this.keys.get(w.url);
      if (isPhotoUrl(w.url)) {
        // The app's own photo: same origin, readable. Its key is its bytes' hash.
        const response = await fetch(w.url);
        blob = await response.blob();
        if (key === undefined) {
          key = `photo:${await sha256(blob)}`;
          this.keys.set(w.url, key);
          if (colours().has(key)) {
            this.startFade(w.url, 'colour');
            this.note(w.url);
          }
        }
      } else if (key === undefined) {
        key = coverKey(w.url);
        this.keys.set(w.url, key);
      }
      if (!key) {
        this.attempts.set(w.url, afterFailure(undefined, Date.now(), true));
        return;
      }
      const pixels = this.needsPixels(w, key);
      let shape = this.needsShape(w, key);
      if (shape && !blob && (isGoogleCover(w.url) || !pixels)) {
        // Its shape from a plain <img> of the cover itself: Google's thumbnails send no CORS
        // headers, and an <img> needs none (it's never drawn, so nothing is tainted).
        const size = await naturalSize(w.url);
        if (this.disposed) return;
        if (size) this.gotShape(w.url, key, size.width, size.height);
        else this.shapeAttempts.set(w.url, afterFailure(this.shapeAttempts.get(w.url), Date.now(), false));
        shape = false;
      }
      if (!pixels && !shape) return;
      if (!blob) {
        const source = pixelSource(w.url, w.isbn);
        if (!source) {
          // Nowhere to read it from (a Google cover with no ISBN): the book keeps its own colour.
          rememberColour(colours(), key, null);
          saveSoon();
          this.attempts.set(w.url, afterFailure(undefined, Date.now(), true));
          return;
        }
        const response = await fetch(source, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new HttpError(response.status);
        blob = await response.blob();
      }
      const decoded = await decode(blob);
      if (this.disposed) {
        decoded.done();
        return;
      }
      // The shape from the decoded bitmap (only its size: no drawing here).
      if (shape && !isGoogleCover(w.url)) this.gotShape(w.url, key, decoded.width, decoded.height);
      if (!pixels) {
        decoded.done();
        return;
      }
      this.measures.push({ wish: w, key, decoded });
      this.arrived.add(w.url);
    } catch (error) {
      // Offline, CORS refused, a 403/429/5xx, or a file that isn't a picture: back off, a few tries a visit.
      const final = error instanceof HttpError ? isFinalStatus(error.status) : false;
      this.attempts.set(w.url, afterFailure(this.attempts.get(w.url), Date.now(), final));
    }
  }

  /** In an idle slice: draw an arrived cover small, read its colour if it's new, keep the picture if it's still near. */
  private measure({ wish: w, key, decoded }: Measure): void {
    try {
      const wantColour = !colours().has(key);
      const wantPicture = w.picture && !this.pictures.has(w.url) && worthKeeping(this.distanceOf(w.url));
      if (!wantColour && !wantPicture) return;
      const size = bitmapSize(decoded.width, decoded.height);
      const small = document.createElement('canvas');
      small.width = size.width;
      small.height = size.height;
      small.getContext('2d')?.drawImage(decoded.source, 0, 0, size.width, size.height);
      if (wantColour) {
        const sample = document.createElement('canvas');
        sample.width = COLOUR_SAMPLE_PX;
        sample.height = COLOUR_SAMPLE_PX;
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(small, 0, 0, COLOUR_SAMPLE_PX, COLOUR_SAMPLE_PX);
          const colour = dominantColour(ctx.getImageData(0, 0, COLOUR_SAMPLE_PX, COLOUR_SAMPLE_PX).data);
          rememberColour(colours(), key, colour);
          this.tints.delete(key);
          saveSoon();
          if (colour) this.startFade(w.url, 'colour');
        }
      }
      if (wantPicture) {
        this.pictures.set(w.url, { picture: { image: small, width: size.width, height: size.height }, used: ++this.used });
        this.startFade(w.url, 'picture');
        this.trim();
      } else release({ image: small, width: 0, height: 0 });
      this.note(w.url);
    } catch {
      this.attempts.set(w.url, afterFailure(this.attempts.get(w.url), Date.now(), false));
    } finally {
      decoded.done();
      this.arrived.delete(w.url);
    }
  }
}
