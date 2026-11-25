/**
 * The Family Staircase's scenery (pure, unit-tested): the sky behind the pile and the meadow it
 * stands on. CanvasStack.tsx draws it on the pile's own (opaque) canvas before the books, from
 * the theme's --stack-* tokens; nothing here touches the page.
 *
 * - **The sky** goes by altitude, absolute and logarithmic: t = log(1 + alt) / log(1 + 1,000),
 *   alt in books above the horizon, so a pile's sky never changes colour as it grows. The low sky
 *   is at the horizon, the high sky about 10 books up, the upper sky about 100, and space from
 *   1,000. The view's gradient runs from the altitude at its top to the altitude at its bottom
 *   (or at the horizon, when that's in view), sampled at SKY_SAMPLES points (altitude is linear
 *   down the screen, t isn't), and the gradient objects are kept by t in 1/SKY_BUCKETS steps.
 * - **The ground** is anchored to the world: its contact line is the base book's bottom, so it
 *   moves 1:1 with the base book, its gap lift included (not the drop's spring: a landing may
 *   press the base book of a short pile into the soft ground). The horizon is GROUND_DEPTH px of
 *   ground behind the pile (less in a short view: groundSize), sin 24° × that above the contact
 *   line on screen. A soft shadow lies
 *   under the base book: its own footprint at height 0, turned with it.
 */
import { LruCache } from './canvasHelpers';
import { GAP_BOOK_HEIGHT } from './stackModel';
import { ELEVATION_DEG, heightAt, type Vec2 } from './stackProjection';

const RAD = Math.PI / 180;
/** How much a height in the pile, and a step towards the reader, move a point down the screen (px per px). */
export const SCENE_RISE = Math.cos(ELEVATION_DEG * RAD);
export const SCENE_DROP = Math.sin(ELEVATION_DEG * RAD);

/** Altitude is counted in books of this height (px in the pile): the thinnest book, as the gap's book height. */
export const ALTITUDE_BOOK = GAP_BOOK_HEIGHT;
/** The sky reaches space this many books above the horizon. */
export const SKY_TOP_BOOKS = 1000;
/** The sky's four colours sit at these altitudes (books): low, high, upper, space. */
export const SKY_STOP_BOOKS = [0, 10, 100, SKY_TOP_BOOKS] as const;
/** Gradients are kept by t in steps of 1 / SKY_BUCKETS. */
export const SKY_BUCKETS = 256;
/** A view's gradient is sampled at this many points from top to bottom. */
export const SKY_SAMPLES = 5;
/** The most sky gradients kept (each is a handful of colour stops). */
export const SKY_CACHE_SIZE = 64;

/** How much ground lies behind the pile (px in the pile, the R of the horizon), in a view at least GROUND_FULL_HEIGHT tall. */
export const GROUND_DEPTH = 300;
/** The haze above the horizon line (px on screen), with all of GROUND_DEPTH. */
export const HORIZON_HAZE = 28;
/** Views at least this tall (px) get all of GROUND_DEPTH; shorter ones (a phone on its side) get less, down to GROUND_SCALE_MIN of it. */
export const GROUND_FULL_HEIGHT = 480;
export const GROUND_SCALE_MIN = 0.6;
/**
 * The base book's shadow: how far it reaches past the footprint (px in the pile) along the spine
 * (`across`) and front to back (`along`), outer then inner, and how far it's moved towards the
 * reader, so it shows mostly as a soft band in front of the spine rather than at the sides.
 */
export const SHADOW_SPREAD = [
  { across: 4, along: 14 },
  { across: 1, along: 5 },
] as const;
export const SHADOW_FORWARD = 6;
/** The outer shadow is this much fainter than the inner one. */
export const SHADOW_OUTER_ALPHA = 0.5;

/** t for an altitude (books above the horizon): 0 at the horizon, 1 from SKY_TOP_BOOKS up. */
export function skyT(altBooks: number): number {
  if (!(altBooks > 0)) return 0;
  return Math.min(1, Math.log1p(altBooks) / Math.log1p(SKY_TOP_BOOKS));
}

/** The altitude (books) for a t: the inverse of skyT. */
export function skyAltitude(t: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return Math.expm1(c * Math.log1p(SKY_TOP_BOOKS));
}

/** The sky's four colours' places in t: low, high, upper, space. */
export const SKY_STOP_T: readonly number[] = SKY_STOP_BOOKS.map(skyT);

/** Which bucket a t falls in. */
export function skyBucket(t: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return Math.round(c * SKY_BUCKETS);
}

export interface SkyStop {
  /** Down the gradient: 0 at its top, 1 at its bottom. */
  offset: number;
  t: number;
}

/**
 * The gradient's stops from t at its top to t at its bottom: SKY_SAMPLES points, evenly down the
 * screen, each with the t of its altitude (altitude is linear down the screen).
 */
export function skyStops(tTop: number, tBottom: number, samples: number = SKY_SAMPLES): SkyStop[] {
  const n = Math.max(2, Math.floor(samples));
  const top = skyAltitude(tTop);
  const bottom = skyAltitude(tBottom);
  return Array.from({ length: n }, (_, i) => {
    const offset = i / (n - 1);
    return { offset, t: skyT(top + (bottom - top) * offset) };
  });
}

// ---- Colours ----

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A token's colour (#rgb, #rrggbb, #rrggbbaa, rgb() or rgba()), or null if it isn't one of those. */
export function parseColour(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: Math.min(1, Math.max(0, alpha)) };
  }
  return null;
}

/** Between a and b (k from 0 to 1). */
export function mix(a: Rgba, b: Rgba, k: number): Rgba {
  const u = Math.min(1, Math.max(0, k));
  return { r: a.r + (b.r - a.r) * u, g: a.g + (b.g - a.g) * u, b: a.b + (b.b - a.b) * u, a: a.a + (b.a - a.a) * u };
}

/** A colour for the canvas. */
export function cssColour(c: Rgba, alpha: number = c.a): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}

/** The sky's colour at t, from its four colours (low, high, upper, space) at SKY_STOP_T. */
export function skyColour(t: number, palette: readonly Rgba[]): Rgba {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < SKY_STOP_T.length; i++) {
    if (c <= SKY_STOP_T[i]) return mix(palette[i - 1], palette[i], (c - SKY_STOP_T[i - 1]) / (SKY_STOP_T[i] - SKY_STOP_T[i - 1]));
  }
  return palette[palette.length - 1];
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (opaque colours). */
export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A month line's ink over `behind`: whichever of the two inks contrasts more with it. */
export function lineInk(behind: Rgba, onLight: Rgba, onDark: Rgba): 'light' | 'dark' {
  return contrast(onLight, behind) >= contrast(onDark, behind) ? 'light' : 'dark';
}

// ---- The ground ----

/**
 * Where the ground meets the base book on screen (y, px): the base book's bottom, as the camera
 * at `s` sees it, with `baseLift` (px, up) the base book's gap lift.
 */
export function groundContactY(centres: readonly number[], s: number, baseLift: number, originY: number): number {
  return originY + SCENE_RISE * (heightAt(centres, s) - baseLift);
}

/** How much ground a view shows behind the pile: its depth (px in the pile) and the haze above its horizon (px). */
export interface GroundSize {
  depth: number;
  haze: number;
}

/**
 * The ground for a view `viewHeight` px tall: all of GROUND_DEPTH (and HORIZON_HAZE) from
 * GROUND_FULL_HEIGHT up, less in proportion below it, but never under GROUND_SCALE_MIN of it, so
 * a short view (a phone on its side) still shows a band of sky above the horizon at the base book.
 */
export function groundSize(viewHeight: number): GroundSize {
  const k = viewHeight > 0 ? Math.min(1, Math.max(GROUND_SCALE_MIN, viewHeight / GROUND_FULL_HEIGHT)) : 1;
  return { depth: GROUND_DEPTH * k, haze: HORIZON_HAZE * k };
}

/** The horizon (y, px): `depth` px of ground behind the contact line, seen at 24°. */
export function horizonY(contactY: number, depth: number = GROUND_DEPTH): number {
  return contactY - SCENE_DROP * Math.max(0, depth);
}

/** How many books above the horizon a point on screen at `y` is (0 at the horizon and below it). */
export function altitudeAt(y: number, horizon: number): number {
  return Math.max(0, (horizon - y) / SCENE_RISE / ALTITUDE_BOOK);
}

/** The sky in a view `height` px tall: t at its top and its bottom, and where its gradient ends (px). */
export interface ViewSky {
  tTop: number;
  tBottom: number;
  /** The gradient runs from y 0 to here: the horizon with the ground drawn and in view, else the view's bottom. */
  bottom: number;
}

/**
 * The sky for this view, or null when there's none to see (the ground drawn, and its horizon at
 * or above the top of the view).
 */
export function viewSky(horizon: number, height: number, ground: boolean): ViewSky | null {
  const bottom = ground ? Math.min(height, horizon) : height;
  if (!(bottom > 0)) return null;
  return { tTop: skyT(altitudeAt(0, horizon)), tBottom: skyT(altitudeAt(bottom, horizon)), bottom };
}

/** Whether any ground shows in a view `height` px tall. */
export function groundInView(horizon: number, height: number): boolean {
  return horizon < height;
}

/**
 * The base book's shadow on the ground: its footprint (width along the spine, depth front to
 * back) grown by `spread` px (along the spine, front to back) and moved `forward` px towards its
 * spine, turned by `yaw` (degrees, the base book's own turn on screen), at height 0 under the
 * book: four corners on screen.
 */
export function groundShadowFootprint(
  shape: { width: number; depth: number },
  yaw: number,
  contactY: number,
  originX: number,
  spread: { across: number; along: number } = { across: 0, along: 0 },
  forward = 0,
): Vec2[] {
  const hw = Math.max(0, shape.width) / 2 + spread.across;
  const hd = Math.max(0, shape.depth) / 2 + spread.along;
  const cy = Math.cos(yaw * RAD);
  const sy = Math.sin(yaw * RAD);
  return [
    [-hw, forward - hd],
    [hw, forward - hd],
    [hw, forward + hd],
    [-hw, forward + hd],
  ].map(([lx, lz]) => {
    // Turned as a book is (stackProjection.projectBook), then seen from 24° above: nearer is lower.
    const x = cy * lx + sy * lz;
    const z = -sy * lx + cy * lz;
    return { x: originX + x, y: contactY + SCENE_DROP * z };
  });
}

/** A falling base book's shadow is gone when it's this high above the ground (px in the pile: a drop starts 420 up). */
export const SHADOW_FADE_HEIGHT = 420;

/**
 * How strong the base book's shadow is with the book `above` px over the ground (a first book
 * falling onto it): 1 on the ground (or pressed into it), fading out by SHADOW_FADE_HEIGHT.
 */
export function shadowStrength(above: number): number {
  if (!(above > 0)) return 1;
  const u = Math.min(1, above / SHADOW_FADE_HEIGHT);
  return (1 - u) * (1 - u);
}

/** Whether the base book's shadow (and so the contact line) is near enough to the view to draw. */
export function shadowInView(contactY: number, height: number, reach: number): boolean {
  return contactY + reach >= 0 && contactY - reach <= height;
}

// ---- The gradient cache ----

/**
 * The sky's gradients, kept by t in 1/SKY_BUCKETS steps: the same buckets give the same object,
 * so a frame makes a new gradient only when the view's altitude has moved on a step. `make` gets
 * the bucketed t's stops (a gradient in a unit square, placed by the canvas's transform).
 */
export class SkyGradients<T> {
  private readonly cache: LruCache<number, T>;

  constructor(
    private readonly make: (stops: SkyStop[]) => T,
    size: number = SKY_CACHE_SIZE,
  ) {
    this.cache = new LruCache<number, T>(size);
  }

  get(tTop: number, tBottom: number): T {
    const top = skyBucket(tTop);
    const bottom = skyBucket(tBottom);
    const key = top * (SKY_BUCKETS + 1) + bottom;
    let got = this.cache.get(key);
    if (got === undefined) {
      got = this.make(skyStops(top / SKY_BUCKETS, bottom / SKY_BUCKETS));
      this.cache.set(key, got);
    }
    return got;
  }
}
