import { LruCache } from './canvasHelpers';
import {
  COLOUR_SAMPLE_PX,
  COLOURS_KEY,
  afterFailure,
  bitmapSize,
  coverKey,
  dominantColour,
  isFinalStatus,
  isPhotoUrl,
  mayTry,
  parseColours,
  pixelSource,
  rememberColour,
  serialiseColours,
  spineColours,
  type Attempts,
  type BookColours,
  type StoredColours,
} from './coverColour';

/**
 * Loads the Family Staircase's real covers, away from the draw loop (CanvasStack asks for the
 * books near the camera; this fetches, decodes and measures them in idle time, then asks for a
 * redraw). Two things per cover:
 *
 * - its colour, for the spine: read from a 16 × 16 copy, kept for every cover in the device's
 *   colour cache (localStorage "library-card:cover-colours": never synced or backed up, cleared
 *   by "Reset this device"), so the next visit has it at once;
 * - a small picture (about 128 px on its longest side) for the books close enough to show their
 *   top face, at most BITMAP_CACHE of them, released when their books scroll far away.
 *
 * Pixels only ever come through CORS (coverColour.pixelSource) or the app's own photos (blob:
 * URLs), so neither the small canvases nor the pile's canvas is ever tainted. A cover that fails
 * is tried again later, a few times a visit at most (coverColour.afterFailure).
 */

/** Pictures kept decoded. */
export const BITMAP_CACHE = 24;
/** Covers loading at once. */
const CONCURRENT = 2;
/** The colour cache is written this long after the last new colour (ms). */
const SAVE_AFTER_MS = 1000;
/** Pictures of books further than this from the camera (books) are released. */
export const RELEASE_DISTANCE = 12;

export interface CoverPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** A book the pile would like covered: `picture` when its top face is close enough to show it. */
export interface CoverWish {
  url: string;
  isbn: string;
  picture: boolean;
  /** Books from the camera (nearest first). */
  distance: number;
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

/** Forget this page's copy (tests, or after "Reset this device" cleared the stored one). */
export function forgetCoverColours(): void {
  stored = null;
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

/** A blob as something drawable, by createImageBitmap or (older browsers) an <img> of its own blob: URL. */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
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

const idle = (fn: () => void): void => {
  const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 300 });
  else window.setTimeout(fn, 30);
};

export class CoverArt {
  /** Cover URL -> colour cache key (a photo's needs its bytes hashed first). */
  private readonly keys = new Map<string, string | null>();
  /** Colour cache key -> spine colours for this ink (null: no usable colour). */
  private readonly tints = new Map<string, BookColours | null>();
  private readonly pictures = new LruCache<string, CoverPicture>(BITMAP_CACHE, release);
  private readonly attempts = new Map<string, Attempts>();
  private readonly loading = new Set<string>();
  private queue: CoverWish[] = [];
  private keep = new Set<string>();
  private pumping = false;
  private changed = false;
  private disposed = false;
  private readonly ink: string;
  private readonly onChange: () => void;

  constructor(options: { ink: string; onChange: () => void }) {
    this.ink = options.ink;
    this.onChange = options.onChange;
  }

  /** The spine colours for a cover, if known (no work here: a lookup). */
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

  /** The cover's small picture, if decoded (no work here: a lookup). */
  picture(url: string | null): CoverPicture | null {
    return url ? (this.pictures.get(url) ?? null) : null;
  }

  /**
   * The books near the camera, nearest first. Replaces what was asked before; pictures of books
   * no longer near are released. Loading happens later, in idle time.
   */
  want(wishes: readonly CoverWish[]): void {
    if (this.disposed) return;
    this.keep = new Set(wishes.filter((w) => w.distance <= RELEASE_DISTANCE).map((w) => w.url));
    for (const url of this.pictures.keys()) if (!this.keep.has(url)) this.pictures.delete(url);
    this.queue = [...wishes].sort((a, b) => Number(b.picture) - Number(a.picture) || a.distance - b.distance);
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.pictures.clear();
  }

  private needs(w: CoverWish): boolean {
    if (this.loading.has(w.url) || !mayTry(this.attempts.get(w.url), Date.now())) return false;
    const key = this.keys.get(w.url) ?? (isPhotoUrl(w.url) ? undefined : coverKey(w.url));
    const known = key ? colours().has(key) : false;
    return !known || (w.picture && !this.pictures.has(w.url));
  }

  private pump(): void {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    idle(() => {
      this.pumping = false;
      while (!this.disposed && this.loading.size < CONCURRENT) {
        const next = this.queue.find((w) => this.needs(w));
        if (!next) break;
        this.queue = this.queue.filter((w) => w !== next);
        this.loading.add(next.url);
        void this.load(next).finally(() => {
          this.loading.delete(next.url);
          this.pump();
        });
      }
    });
  }

  private note(): void {
    if (this.changed) return;
    this.changed = true;
    window.setTimeout(() => {
      this.changed = false;
      if (!this.disposed) this.onChange();
    }, 0);
  }

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
          if (colours().has(key)) this.note();
        }
      } else if (key === undefined) {
        key = coverKey(w.url);
        this.keys.set(w.url, key);
      }
      if (!key) {
        this.attempts.set(w.url, afterFailure(undefined, Date.now(), true));
        return;
      }
      const wantColour = !colours().has(key);
      const wantPicture = w.picture && this.keep.has(w.url);
      if (!wantColour && !wantPicture) return;
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
      try {
        if (this.disposed) return;
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
            rememberColour(colours(), key, dominantColour(ctx.getImageData(0, 0, COLOUR_SAMPLE_PX, COLOUR_SAMPLE_PX).data));
            this.tints.delete(key);
            saveSoon();
          }
        }
        if (wantPicture && this.keep.has(w.url)) this.pictures.set(w.url, { image: small, width: size.width, height: size.height });
        else release({ image: small, width: 0, height: 0 });
        this.note();
      } finally {
        decoded.done();
      }
    } catch (error) {
      // Offline, CORS refused, a 403/429/5xx, or a file that isn't a picture: back off, a few tries a visit.
      const final = error instanceof HttpError ? isFinalStatus(error.status) : false;
      this.attempts.set(w.url, afterFailure(this.attempts.get(w.url), Date.now(), final));
    }
  }
}
