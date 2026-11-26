/**
 * The Family Staircase's backdrop clouds (pure, unit-tested): where they are, how they move and
 * how many are drawn. CanvasStack.tsx paints them on the pile's canvas after the sky and before
 * the ground and the books (so the meadow hides a cloud behind the horizon, and no cloud is ever
 * in front of a book), from sprites made once per resolution (renderCloudSprite), from the
 * --stack-cloud tokens. Nothing here touches the page.
 *
 * - **Where**: the sky is cut into altitude cells of CLOUD_CELL_BOOKS books; each cell has 0–2
 *   clouds from a hash of the household, the layer and the cell (cellClouds), so they never move
 *   as the pile grows, nor between visits or devices. None below CLOUD_MIN_ALT books; above sky t
 *   CLOUD_THIN_FROM they thin out towards space (none at t 1).
 * - **How they move**: each cloud has its own parallax factor in PARALLAX: on screen it moves that
 *   much of the pile's scroll, as if far away (cloudBaseY). Only when a frame is drawn anyway (the
 *   camera, a drop): no idle loop, no timers. With reduced motion they move 1:1 with the world.
 * - **How many**: at most MAX_CLOUDS[decor] a frame (those nearest the middle of the view when
 *   there are more, so any that wait for room do it at the edges). Reduced decor keeps about half
 *   of them (the "core" ones), none keeps none.
 * - **The eye line**: a cloud crossing the eye-line band (the book there, eyeLineReach) fades to
 *   EYE_ALPHA, easing back over EYE_FADE_PX either side (a step with reduced motion), so the spine
 *   title, the book sheet's edge and the markers there stay calm.
 */
import type { Decor } from './drawBudget';
import { ALTITUDE_BOOK, SCENE_RISE, skyT } from './scenery';
import { mixedHash } from './stackModel';

/** Each altitude cell is this many books of sky. */
export const CLOUD_CELL_BOOKS = 18;
/** No clouds below this altitude (books above the horizon). */
export const CLOUD_MIN_ALT = 3;
/** Above this sky t the clouds thin out, to none at t 1 (space). */
export const CLOUD_THIN_FROM = 0.8;
/** Each cloud moves this much of the pile's scroll (its own factor in this range). */
export const PARALLAX = [0.25, 0.35] as const;
/** A cloud's width on screen (px): nearer ones (a bigger factor) tend to be bigger. */
export const CLOUD_WIDTH = [90, 170] as const;
/** A cloud sprite's box is this tall for its width; its flat base is CLOUD_BASE of the width down it. */
export const CLOUD_ASPECT = 0.5;
export const CLOUD_BASE = 0.46;
/** The most clouds drawn in one frame, by decor level. */
export const MAX_CLOUDS: Record<Decor, number> = { full: 5, reduced: 3, none: 0 };
/** How strong a cloud is (alpha) from its factor: the furthest PARALLAX[0] to the nearest PARALLAX[1]. */
export const CLOUD_ALPHA = [0.85, 0.95] as const;
/** A cloud crossing the eye-line band is this strong (alpha × this)… */
export const EYE_ALPHA = 0.2;
/** …easing back to full over this far (px) from the band. */
export const EYE_FADE_PX = 32;

/** One puff (circle) of a cloud shape, in a sprite of width 1: centre and radius. */
export interface Puff {
  x: number;
  y: number;
  r: number;
}

/**
 * The six cloud shapes, in a box 1 wide and CLOUD_ASPECT tall: soft flat-bottomed puffs joined by
 * a bar along the base from the first puff's centre to the last's (renderCloudSprite).
 */
export const CLOUD_SHAPES: readonly (readonly Puff[])[] = [
  [
    { x: 0.2, y: 0.36, r: 0.11 },
    { x: 0.38, y: 0.27, r: 0.17 },
    { x: 0.6, y: 0.29, r: 0.16 },
    { x: 0.8, y: 0.37, r: 0.1 },
  ],
  [
    { x: 0.16, y: 0.38, r: 0.09 },
    { x: 0.32, y: 0.3, r: 0.14 },
    { x: 0.52, y: 0.22, r: 0.19 },
    { x: 0.72, y: 0.3, r: 0.14 },
    { x: 0.86, y: 0.38, r: 0.09 },
  ],
  [
    { x: 0.25, y: 0.34, r: 0.13 },
    { x: 0.48, y: 0.24, r: 0.2 },
    { x: 0.74, y: 0.34, r: 0.13 },
  ],
  [
    { x: 0.14, y: 0.39, r: 0.08 },
    { x: 0.3, y: 0.31, r: 0.13 },
    { x: 0.5, y: 0.31, r: 0.15 },
    { x: 0.7, y: 0.27, r: 0.15 },
    { x: 0.86, y: 0.38, r: 0.09 },
  ],
  [
    { x: 0.1, y: 0.4, r: 0.07 },
    { x: 0.26, y: 0.34, r: 0.11 },
    { x: 0.44, y: 0.3, r: 0.13 },
    { x: 0.62, y: 0.33, r: 0.12 },
    { x: 0.78, y: 0.36, r: 0.1 },
    { x: 0.9, y: 0.4, r: 0.07 },
  ],
  [
    { x: 0.3, y: 0.35, r: 0.12 },
    { x: 0.5, y: 0.22, r: 0.18 },
    { x: 0.7, y: 0.35, r: 0.12 },
  ],
];

/** The base bar's height (sprite widths), up from the base. */
export const CLOUD_BAR = 0.1;
/** The light part sits this far up (sprite widths) from the shade under it, leaving a shaded rim at the bottom. */
export const CLOUD_SHADE_RISE = 0.035;

/** How high a shape's top is in its sprite (sprite widths from the top). */
export function shapeTop(shape: readonly Puff[]): number {
  return Math.min(...shape.map((p) => p.y - p.r));
}

/** One backdrop cloud, from its cell's hash: altitude (books), across (0–1), width (px), shape, parallax factor, and whether reduced decor keeps it. */
export interface Cloud {
  cell: number;
  alt: number;
  across: number;
  width: number;
  shape: number;
  factor: number;
  core: boolean;
}

/** How likely a cloud at sky t is to be there: 1 up to CLOUD_THIN_FROM, then down to 0 at t 1. */
export function cloudDensity(t: number): number {
  if (!(t > CLOUD_THIN_FROM)) return 1;
  return Math.max(0, (1 - t) / (1 - CLOUD_THIN_FROM));
}

/** A number in [0, 1) for the cell's n-th draw: the same on every device and every visit. */
function draw(seed: string, cell: number, n: number): number {
  return mixedHash(`${seed}|backdrop|${cell}|${n}`) / 2 ** 32;
}

/** The clouds of altitude cell `cell` (0: the horizon to CLOUD_CELL_BOOKS books up), from the household `seed`. */
export function cellClouds(seed: string, cell: number): Cloud[] {
  if (!(cell >= 0) || !Number.isInteger(cell)) return [];
  const roll = draw(seed, cell, 0);
  const count = roll < 0.3 ? 0 : roll < 0.8 ? 1 : 2;
  const out: Cloud[] = [];
  let firstAcross = 0;
  for (let j = 0; j < count; j++) {
    const at = (k: number) => draw(seed, cell, 1 + j * 8 + k);
    const alt = (cell + at(0)) * CLOUD_CELL_BOOKS;
    // A second cloud in a cell keeps its distance across the sky from the first.
    const across = j === 0 ? at(2) : (firstAcross + 0.35 + 0.3 * at(2)) % 1;
    if (j === 0) firstAcross = across;
    if (alt < CLOUD_MIN_ALT || at(1) >= cloudDensity(skyT(alt))) continue;
    const near = at(3);
    out.push({
      cell,
      alt,
      across,
      factor: PARALLAX[0] + (PARALLAX[1] - PARALLAX[0]) * near,
      width: CLOUD_WIDTH[0] + (CLOUD_WIDTH[1] - CLOUD_WIDTH[0]) * (0.6 * near + 0.4 * at(4)),
      shape: Math.min(CLOUD_SHAPES.length - 1, Math.floor(at(5) * CLOUD_SHAPES.length)),
      core: at(6) < 0.5,
    });
  }
  return out;
}

/** px on screen per book of altitude, 1:1 with the world. */
const PX_PER_ALT = SCENE_RISE * ALTITUDE_BOOK;

/**
 * A cloud's base line on screen (y, px) in a view `height` tall whose horizon is at `horizon`:
 * where the world puts its altitude, drawn `factor` of the way from the eye line (the middle of
 * the view) to there. So it moves `factor` of every scroll, and sits at the eye line when the
 * camera's altitude is its own. Factor 1: 1:1 with the world.
 */
export function cloudBaseY(alt: number, factor: number, horizon: number, height: number): number {
  const mid = height / 2;
  return mid + factor * (horizon - alt * PX_PER_ALT - mid);
}

/** A cloud's strength by the eye-line band (the eye line ± `reach`): EYE_ALPHA crossing it, back to 1 over EYE_FADE_PX (a step with reduced motion). */
export function eyeLineFade(top: number, bottom: number, eyeLine: number, reach: number, reduced: boolean): number {
  const above = eyeLine - reach - bottom;
  const below = top - (eyeLine + reach);
  const away = Math.max(above, below);
  if (away <= 0) return EYE_ALPHA;
  if (reduced) return 1;
  return EYE_ALPHA + (1 - EYE_ALPHA) * Math.min(1, away / EYE_FADE_PX);
}

/** What a frame sees: the view, its horizon, whether the ground is drawn (it hides clouds behind the horizon), the decor and the eye-line band. */
export interface CloudView {
  seed: string;
  width: number;
  height: number;
  horizon: number;
  ground: boolean;
  decor: Decor;
  reduced: boolean;
  /** How far (px) the eye-line band reaches above and below the eye line. */
  eyeReach: number;
}

/** A cloud to draw: its sprite (shape), box on screen (px) and alpha. */
export interface PlacedCloud {
  shape: number;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  /** Its parallax factor (for the draw order: far first). */
  factor: number;
}

/** The altitude cells a view can show clouds from: [first, last], or null for none. */
export function cellsInView(view: Pick<CloudView, 'height' | 'horizon' | 'reduced'>): { first: number; last: number } | null {
  const { height, horizon, reduced } = view;
  if (!(height > 0)) return null;
  const f = reduced ? 1 : PARALLAX[0];
  const mid = height / 2;
  // A cloud shows while its base is below the top of the view and its top above the bottom.
  const altAt = (y: number) => (horizon - (mid + (y - mid) / f)) / PX_PER_ALT;
  const lo = Math.max(CLOUD_MIN_ALT, altAt(height + CLOUD_WIDTH[1] * CLOUD_BASE));
  const hi = altAt(0);
  if (!(hi >= lo)) return null;
  return { first: Math.floor(lo / CLOUD_CELL_BOOKS), last: Math.floor(hi / CLOUD_CELL_BOOKS) };
}

/**
 * The clouds to draw this frame, far first: those on screen (and not wholly behind the horizon),
 * at most MAX_CLOUDS[decor], each faded near the eye line. Empty with decor none or no cell in view.
 */
export function placeClouds(view: CloudView): PlacedCloud[] {
  const max = MAX_CLOUDS[view.decor];
  if (max <= 0) return [];
  const cells = cellsInView(view);
  if (!cells) return [];
  const { width, height, horizon, reduced } = view;
  const mid = height / 2;
  const out: (PlacedCloud & { middle: number })[] = [];
  for (let cell = cells.first; cell <= cells.last; cell++) {
    for (const cloud of cellClouds(view.seed, cell)) {
      if (view.decor === 'reduced' && !cloud.core) continue;
      const factor = reduced ? 1 : cloud.factor;
      const base = cloudBaseY(cloud.alt, factor, horizon, height);
      const w = cloud.width;
      const y = base - CLOUD_BASE * w;
      if (!(base > 0) || !(y < height)) continue;
      if (view.ground && y >= horizon) continue;
      const strength = CLOUD_ALPHA[0] + ((CLOUD_ALPHA[1] - CLOUD_ALPHA[0]) * (cloud.factor - PARALLAX[0])) / (PARALLAX[1] - PARALLAX[0]);
      const top = y + shapeTop(CLOUD_SHAPES[cloud.shape]) * w;
      out.push({
        shape: cloud.shape,
        x: (-0.05 + 1.1 * cloud.across) * width - w / 2,
        y,
        width: w,
        height: CLOUD_ASPECT * w,
        alpha: strength * eyeLineFade(top, base, mid, view.eyeReach, reduced),
        factor,
        middle: (top + base) / 2,
      });
    }
  }
  if (out.length > max) {
    out.sort((a, b) => Math.abs(a.middle - mid) - Math.abs(b.middle - mid));
    out.length = max;
  }
  out.sort((a, b) => a.factor - b.factor);
  return out.map(({ middle, ...placed }) => (void middle, placed));
}
