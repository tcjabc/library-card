import {
  COLOUR_SAMPLE_PX,
  COLOURS_KEY,
  SHAPES_KEY,
  afterFailure,
  bitmapSize,
  coverKey,
  coverSource,
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
  type CoverSourceKind,
  type StoredColours,
  type StoredShapes,
} from './coverColour';
import { coverAspect } from './bookShapes';
import { evictions, fadeProgress, fadeStart, sliceHasRoom, worthKeeping } from './coverPlan';
import { drawGuarded, markTainted, readPixels } from './pixelGuard';

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
 *   natural size of a plain <img> of the cover itself; kept in the device's shape cache
 *   (localStorage "library-card:cover-shapes", beside the colours).
 *
 * Where the picture comes from (coverColour.coverSource): the app's own photo (blob: URLs), a
 * cover read through CORS (Open Library, also for a Google Books cover by its ISBN), or, once
 * Open Library has no cover for a Google Books book or fails, the Google thumbnail itself as a
 * plain <img>. That one is drawn but never read: its small copy is marked tainted, it gives no
 * colour (the spine keeps the book's own), and the pile's canvas, which then holds it, is never
 * read either (pixelGuard.ts). A cover that fails is tried again later, a few times a visit at
 * most (coverColour.afterFailure), also while the camera rests. A cover arriving for a book on
 * screen fades in (coverPlan.fadeStart); the pile draws the fade.
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
/** A cover waiting to be tried again is looked at this long after its wait ends (ms). */
const WAKE_SLACK_MS = 50;

export interface CoverPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** A copy of a picture loaded without CORS (a Google thumbnail): drawable, never read back. */
  tainted?: boolean;
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

/** A cover's state for the developer tools' Cover diagnostics (coverDiagnostics.ts). */
export interface CoverState {
  /** Where its picture comes from now. */
  source: CoverSourceKind;
  state: 'not requested' | 'loading' | 'ready' | 'failed' | 'backoff';
  /** The last failure from the current source: an HTTP status ("404"), "network", "no source", "not a picture", "image failed". */
  reason: string | null;
  /** In backoff: not tried again before this time (ms, Date.now()). */
  until: number | null;
  /** Tries so far from the current source this visit. */
  attempts: number;
  /** A Google cover drawn from its thumbnail: why Open Library didn't give it ("404", "429", "no ISBN"). */
  openLibrary: string | null;
  /** This device's colour cache: a colour, "none" (the cover has no usable colour), or not known yet. */
  colour: 'yes' | 'none' | 'no';
  /** This device's shape cache has its shape. */
  shape: boolean;
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

/**
 * A plain <img> of a cover (no crossOrigin attribute: no CORS needed), decoded, or null if it
 * won't load. Its pixels can never be read; it is only measured (natural size) or drawn.
 */
function plainImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
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
  /** Loaded without CORS (a Google thumbnail's plain <img>): drawn, never read. */
  tainted?: boolean;
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

/** Why a fetch failed, for the diagnostics. */
function failureReason(error: unknown): string {
  if (error instanceof HttpError) return String(error.status);
  if (error instanceof TypeError) return 'network';
  return 'not a picture';
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

/** What a wish needs loaded now: its pixels through CORS, its Google thumbnail as a plain <img>, or nothing. */
type Job = 'cors' | 'img' | null;

export class CoverArt {
  /** Cover URL -> colour cache key (a photo's needs its bytes hashed first). */
  private readonly keys = new Map<string, string | null>();
  /** Colour cache key -> spine colours for this ink (null: no usable colour). */
  private readonly tints = new Map<string, BookColours | null>();
  private readonly pictures = new Map<string, Kept>();
  /** Tries of a cover's CORS source (Open Library, by ISBN for a Google cover; a photo; any other https cover). */
  private readonly attempts = new Map<string, Attempts>();
  /** Tries of a Google cover's own thumbnail as a plain <img>, once Open Library has no cover or fails. */
  private readonly imgAttempts = new Map<string, Attempts>();
  /** Shape reads fail and back off on their own (a Google cover's <img> is a different fetch). */
  private readonly shapeAttempts = new Map<string, Attempts>();
  /** The last failure of each (diagnostics). */
  private readonly failures = new Map<string, string>();
  private readonly imgFailures = new Map<string, string>();
  private readonly loading = new Set<string>();
  /** Covers fetched and decoded, waiting to be measured (not fetched again meanwhile). */
  private readonly arrived = new Set<string>();
  /** Covers passed over while loading or waiting to be measured: looked at again when that ends. */
  private readonly revisit = new Set<string>();
  private readonly fades = new Map<string, Fade>();
  private measures: Measure[] = [];
  private queue: readonly CoverWish[] = [];
  /** The covers whose pictures the latest ask wants (a load started earlier for a colour only may now need its picture too). */
  private pictureWanted: ReadonlySet<string> = new Set();
  /** Where the next look for work in `queue` starts (everything before it is taken or not needed now). */
  private cursor = 0;
  private tintCursor = 0;
  private drawn: ReadonlySet<string> = new Set();
  private distanceOf: (url: string) => number = () => Infinity;
  private used = 0;
  private pumping = false;
  private changed = false;
  private disposed = false;
  /** The earliest time a cover waiting to be tried again may be (ms, Date.now()), and its timer. */
  private wakeAt = Infinity;
  private wakeTimer = 0;
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

  /** A cover's state on this device now (developer tools' Cover diagnostics; a few lookups). */
  describe(url: string, isbn: string): CoverState {
    const key = this.keyOf(url);
    const raw = key ? colours().get(key) : undefined;
    const colour = raw === undefined ? 'no' : raw ? 'yes' : 'none';
    const shape = !!key && shapes().has(key);
    const corsFailed = this.openLibraryFailed(url);
    const source = coverSource(url, isbn, corsFailed).kind;
    const google = source === 'google';
    const tries = (google ? this.imgAttempts : this.attempts).get(url);
    const reason = (google ? this.imgFailures : this.failures).get(url) ?? null;
    const openLibrary = google ? (this.failures.get(url) ?? (pixelSource(url, isbn) ? null : 'no ISBN')) : null;
    let state: CoverState['state'];
    if (this.pictures.has(url)) state = 'ready';
    else if (this.loading.has(url) || this.arrived.has(url)) state = 'loading';
    else if (!tries) state = 'not requested';
    else state = tries.done ? 'failed' : 'backoff';
    return {
      source,
      state,
      reason,
      until: state === 'backoff' && tries ? tries.nextAt : null,
      attempts: tries?.tries ?? 0,
      openLibrary,
      colour,
      shape,
    };
  }

  /**
   * The books near the camera, most wanted first. Replaces what was asked before; pictures are
   * released by coverPlan.evictions. Loading and measuring happen later, in idle time.
   */
  want(ask: CoverAsk): void {
    if (this.disposed) return;
    this.queue = ask.wishes;
    const pictureWanted = new Set<string>();
    for (const w of ask.wishes) if (w.picture) pictureWanted.add(w.url);
    this.pictureWanted = pictureWanted;
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
    window.clearTimeout(this.wakeTimer);
    this.wakeTimer = 0;
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

  /** Its CORS source has failed at least once this visit (for a Google cover: its picture comes from Google now). */
  private openLibraryFailed(url: string): boolean {
    return (this.attempts.get(url)?.tries ?? 0) > 0;
  }

  /** The latest ask wants this cover's picture, and it isn't kept yet. */
  private wantsPicture(url: string): boolean {
    return this.pictureWanted.has(url) && !this.pictures.has(url) && worthKeeping(this.distanceOf(url));
  }

  /**
   * What to load for a wish now. Through CORS while its colour isn't known or its picture is
   * wanted (and that source may be tried); for a Google cover whose Open Library cover is missing
   * or failing, the picture from its own thumbnail instead, and Open Library again only for the
   * colour, once its wait is over.
   */
  private job(w: CoverWish, key: string | null | undefined): Job {
    const now = Date.now();
    const known = key ? colours().has(key) : false;
    const picture = this.wantsPicture(w.url);
    const source = coverSource(w.url, w.isbn, this.openLibraryFailed(w.url));
    if (source.kind === 'none') return null;
    if (source.kind === 'google') {
      if (picture && mayTry(this.imgAttempts.get(w.url), now)) return 'img';
      return !known && pixelSource(w.url, w.isbn) && mayTry(this.attempts.get(w.url), now) ? 'cors' : null;
    }
    if (!mayTry(this.attempts.get(w.url), now)) return null;
    return !known || picture ? 'cors' : null;
  }

  private needsShape(w: CoverWish, key: string | null | undefined): boolean {
    if (!this.wantShapes || !mayTry(this.shapeAttempts.get(w.url), Date.now())) return false;
    return !(key && shapes().has(key));
  }

  private needs(w: CoverWish): boolean {
    if (this.loading.has(w.url) || this.arrived.has(w.url)) {
      // Busy: looked at again when that's done (its picture may be wanted by now).
      this.revisit.add(w.url);
      return false;
    }
    const key = this.keyOf(w.url);
    return this.job(w, key) !== null || this.needsShape(w, key);
  }

  /** A try failed: back off (coverColour.afterFailure), and look again when the wait is over, even with the camera at rest. */
  private failed(tries: Map<string, Attempts>, url: string, final: boolean): void {
    const next = afterFailure(tries.get(url), Date.now(), final);
    tries.set(url, next);
    if (!next.done) this.wakeLater(next.nextAt);
  }

  private wakeLater(at: number): void {
    if (this.disposed || !(at < this.wakeAt)) return;
    this.wakeAt = at;
    window.clearTimeout(this.wakeTimer);
    this.wakeTimer = window.setTimeout(
      () => {
        this.wakeTimer = 0;
        this.wakeAt = Infinity;
        if (this.disposed) return;
        this.cursor = 0;
        this.pump();
      },
      Math.max(0, at - Date.now()) + WAKE_SLACK_MS,
    );
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
          // Passed over meanwhile, or something left to do (a Google cover's picture once Open
          // Library failed): look through the queue again.
          if (this.revisit.delete(w.url) || this.needs(w)) this.cursor = 0;
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
        this.failures.set(w.url, 'no source');
        this.attempts.set(w.url, afterFailure(undefined, Date.now(), true));
        return;
      }
      const job = this.job(w, key);
      let shape = this.needsShape(w, key);
      if (job === 'img') {
        await this.loadThumbnail(w, key, shape);
        return;
      }
      if (shape && !blob && (isGoogleCover(w.url) || !job)) {
        // Its shape from a plain <img> of the cover itself: Google's thumbnails send no CORS
        // headers, and an <img> needs none (only its size is read here).
        const img = await plainImage(w.url.replace(/^http:/i, 'https:'));
        if (this.disposed) return;
        if (img) this.gotShape(w.url, key, img.naturalWidth, img.naturalHeight);
        else this.failed(this.shapeAttempts, w.url, false);
        shape = false;
      }
      if (!job) return;
      if (!blob) {
        const source = pixelSource(w.url, w.isbn);
        if (!source) {
          // Nowhere to read it from: the book keeps its own colour.
          rememberColour(colours(), key, null);
          saveSoon();
          this.failures.set(w.url, 'no source');
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
      this.measures.push({ wish: w, key, decoded });
      this.arrived.add(w.url);
    } catch (error) {
      // Offline, CORS refused, a 403/429/5xx, or a file that isn't a picture: back off, a few tries a visit.
      this.failures.set(w.url, failureReason(error));
      this.failed(this.attempts, w.url, error instanceof HttpError ? isFinalStatus(error.status) : false);
    }
  }

  /**
   * A Google cover whose Open Library cover is missing or failing: its own thumbnail as a plain
   * <img> (no CORS), its shape from that, and its picture drawn from it in measure() (never read).
   */
  private async loadThumbnail(w: CoverWish, key: string, shape: boolean): Promise<void> {
    const source = coverSource(w.url, w.isbn, true);
    const img = source.url ? await plainImage(source.url) : null;
    if (this.disposed) return;
    if (!img) {
      this.imgFailures.set(w.url, 'image failed');
      this.failed(this.imgAttempts, w.url, false);
      return;
    }
    if (shape) this.gotShape(w.url, key, img.naturalWidth, img.naturalHeight);
    this.measures.push({ wish: w, key, decoded: { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => {}, tainted: true } });
    this.arrived.add(w.url);
  }

  /** In an idle slice: draw an arrived cover small, read its colour if it's new (never a tainted one), keep the picture if it's still wanted. */
  private measure({ wish: w, key, decoded }: Measure): void {
    try {
      const wantColour = !decoded.tainted && !colours().has(key);
      // The latest ask decides (it may want the picture of a cover first loaded for its colour only).
      const wantPicture = this.wantsPicture(w.url);
      if (!wantColour && !wantPicture) return;
      const size = bitmapSize(decoded.width, decoded.height);
      const small = document.createElement('canvas');
      small.width = size.width;
      small.height = size.height;
      const smallCtx = small.getContext('2d');
      if (smallCtx) drawGuarded(smallCtx, decoded.source, 0, 0, size.width, size.height, decoded.tainted);
      else if (decoded.tainted) markTainted(small);
      if (wantColour) {
        const sample = document.createElement('canvas');
        sample.width = COLOUR_SAMPLE_PX;
        sample.height = COLOUR_SAMPLE_PX;
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          drawGuarded(ctx, small, 0, 0, COLOUR_SAMPLE_PX, COLOUR_SAMPLE_PX);
          const colour = dominantColour(readPixels(ctx, 0, 0, COLOUR_SAMPLE_PX, COLOUR_SAMPLE_PX));
          rememberColour(colours(), key, colour);
          this.tints.delete(key);
          saveSoon();
          if (colour) this.startFade(w.url, 'colour');
        }
      }
      if (wantPicture) {
        this.pictures.set(w.url, { picture: { image: small, width: size.width, height: size.height, tainted: decoded.tainted }, used: ++this.used });
        this.startFade(w.url, 'picture');
        this.trim();
      } else release({ image: small, width: 0, height: 0 });
      this.note(w.url);
    } catch {
      if (decoded.tainted) this.failed(this.imgAttempts, w.url, false);
      else this.failed(this.attempts, w.url, false);
    } finally {
      decoded.done();
      this.arrived.delete(w.url);
      if (this.revisit.delete(w.url)) this.cursor = 0;
    }
  }
}
