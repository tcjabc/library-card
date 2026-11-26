/**
 * The Family Staircase's clouds (pure, unit-tested): where they are, how they move and how many
 * are drawn, in three layers. CanvasStack.tsx paints them on the pile's canvas from one sprite
 * atlas made once per resolution, in the --stack-cloud tokens; nothing here touches the page.
 *
 * - **Backdrop** (`backdrop`): soft clouds far behind the pile, after the sky and before the
 *   ground (so the meadow hides any behind the horizon). Each moves its own factor in PARALLAX
 *   (0.25–0.35) of the pile's scroll. At most five (Full), about half of them with Reduced.
 * - **Foreground** (`foreground`): a few small, thin, faint wisps nearer than the pile, moving
 *   faster than it (FOREGROUND_PARALLAX, 1.2–1.4×), after the ground and still before the books,
 *   so a book always covers them. At most three, and only with Full decor.
 * - **Still** (`still`): with reduced motion, instead of both: clouds that move 1:1 with the
 *   world (no parallax), from their own denser cells so a view usually has one to three, never
 *   more than the Reduced cap.
 *
 * In every layer the sky is cut into altitude cells; each cell has 0–2 clouds from a hash of the
 * household, the layer and the cell (cellClouds), so they never move as the pile grows, nor between
 * visits or devices. None below CLOUD_MIN_ALT books; above sky t CLOUD_THIN_FROM they thin out to
 * none at t 1. Clouds change only when a frame is drawn anyway (the camera, a drop): no idle loop.
 * A cloud crossing the eye-line band (the book there, eyeLineReach) fades to EYE_ALPHA, easing back
 * over EYE_FADE_PX (a step with reduced motion), so the spine title, the book sheet's edge and the
 * markers there stay calm. When more clouds are in view than a layer may draw, those nearest the
 * middle of the view are drawn, so any that wait for room do it at the edges.
 */
import type { Decor } from './drawBudget';
import { ALTITUDE_BOOK, SCENE_RISE, skyT } from './scenery';
import { mixedHash } from './stackModel';

/** The backdrop's altitude cells are this many books of sky. */
export const CLOUD_CELL_BOOKS = 18;
/** No clouds below this altitude (books above the horizon). */
export const CLOUD_MIN_ALT = 3;
/** Above this sky t the clouds thin out, to none at t 1 (space). */
export const CLOUD_THIN_FROM = 0.8;
/** Each backdrop cloud moves this much of the pile's scroll (its own factor in this range). */
export const PARALLAX = [0.25, 0.35] as const;
/** Each foreground wisp moves this much of the pile's scroll: faster than the pile. */
export const FOREGROUND_PARALLAX = [1.2, 1.4] as const;
/** A backdrop cloud's width on screen (px): nearer ones (a bigger factor) tend to be bigger. Also the sprites' width. */
export const CLOUD_WIDTH = [90, 170] as const;
/** A cloud sprite's box is this tall for its width; its flat base is CLOUD_BASE of the width down it. */
export const CLOUD_ASPECT = 0.5;
export const CLOUD_BASE = 0.46;
/** The most backdrop clouds drawn in one frame, by decor level. */
export const MAX_CLOUDS: Record<Decor, number> = { full: 5, reduced: 3, none: 0 };
/** How strong a backdrop cloud is (alpha): the furthest first. */
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
 * The cloud shapes, in a box 1 wide and CLOUD_ASPECT tall: soft flat-bottomed puffs joined by a
 * bar along the base from the first puff's centre to the last's (CanvasStack's cloud atlas). Six
 * for the backdrop, then three thin wisps for the foreground (WISP_SHAPES).
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
  // The foreground wisps (WISP_SHAPES): long, low and thin.
  [
    { x: 0.12, y: 0.42, r: 0.05 },
    { x: 0.28, y: 0.39, r: 0.07 },
    { x: 0.46, y: 0.38, r: 0.08 },
    { x: 0.64, y: 0.39, r: 0.07 },
    { x: 0.82, y: 0.42, r: 0.05 },
  ],
  [
    { x: 0.1, y: 0.43, r: 0.04 },
    { x: 0.24, y: 0.4, r: 0.06 },
    { x: 0.4, y: 0.37, r: 0.09 },
    { x: 0.58, y: 0.4, r: 0.06 },
    { x: 0.74, y: 0.41, r: 0.06 },
    { x: 0.9, y: 0.43, r: 0.04 },
  ],
  [
    { x: 0.15, y: 0.41, r: 0.06 },
    { x: 0.35, y: 0.36, r: 0.1 },
    { x: 0.58, y: 0.38, r: 0.08 },
    { x: 0.8, y: 0.42, r: 0.05 },
  ],
];

/** The backdrop's shapes in CLOUD_SHAPES ([from, to)), and the foreground wisps'. */
export const BACKDROP_SHAPES = [0, 6] as const;
export const WISP_SHAPES = [6, 9] as const;

/** The base bar's height (sprite widths), up from the base. */
export const CLOUD_BAR = 0.1;
/** The light part sits this far up (sprite widths) from the shade under it, leaving a shaded rim at the bottom. */
export const CLOUD_SHADE_RISE = 0.035;

/** The cloud layers: far behind the pile, wisps in front of it (behind the books), and the reduced-motion layer. */
export type CloudLayer = 'backdrop' | 'foreground' | 'still';

/** What makes a layer: its cells, how many clouds a cell has, how they move and look, and how many are drawn. */
export interface LayerSpec {
  /** Each altitude cell is this many books of sky. */
  cell: number;
  /** A cell has no cloud below the first roll, one below the second, else two. */
  counts: readonly [number, number];
  /** How much of the pile's scroll each cloud moves (its own factor in this range). */
  factor: readonly [number, number];
  /** Width on screen (px): nearer clouds tend to be bigger. */
  width: readonly [number, number];
  /** How strong (alpha): the furthest first. */
  alpha: readonly [number, number];
  /** Which of CLOUD_SHAPES the layer uses: [from, to). */
  shapes: readonly [number, number];
  /** The most drawn in one frame, by decor level. */
  max: Record<Decor, number>;
  /** Reduced decor keeps only about half of them (the "core" ones). */
  halfWhenReduced: boolean;
  /** Drawn before the ground, so the ground hides any behind the horizon. */
  behindGround: boolean;
}

export const LAYERS: Record<CloudLayer, LayerSpec> = {
  backdrop: {
    cell: CLOUD_CELL_BOOKS,
    counts: [0.3, 0.8],
    factor: PARALLAX,
    width: CLOUD_WIDTH,
    alpha: CLOUD_ALPHA,
    shapes: BACKDROP_SHAPES,
    max: MAX_CLOUDS,
    halfWhenReduced: true,
    behindGround: true,
  },
  foreground: {
    cell: 12,
    counts: [0.45, 0.85],
    factor: FOREGROUND_PARALLAX,
    width: [90, 150],
    alpha: [0.35, 0.5],
    shapes: WISP_SHAPES,
    max: { full: 3, reduced: 0, none: 0 },
    halfWhenReduced: false,
    behindGround: false,
  },
  still: {
    cell: 10,
    counts: [0.15, 0.75],
    factor: [1, 1],
    width: CLOUD_WIDTH,
    alpha: CLOUD_ALPHA,
    shapes: BACKDROP_SHAPES,
    // Reduced motion shows Reduced decor at most: never more than the Reduced cap.
    max: { full: MAX_CLOUDS.reduced, reduced: MAX_CLOUDS.reduced, none: 0 },
    halfWhenReduced: false,
    behindGround: true,
  },
};

/** The layers a frame draws, far first: with reduced motion only the still layer; else the backdrop, and with Full decor (and the foreground on) the wisps. */
export function cloudLayers(decor: Decor, reduced: boolean, foreground: boolean): CloudLayer[] {
  if (decor === 'none') return [];
  if (reduced) return ['still'];
  return decor === 'full' && foreground ? ['backdrop', 'foreground'] : ['backdrop'];
}

/** How high a shape's top is in its sprite (sprite widths from the top). */
export function shapeTop(shape: readonly Puff[]): number {
  return Math.min(...shape.map((p) => p.y - p.r));
}

/** One cloud, from its cell's hash: altitude (books), across (0–1), width (px), shape, parallax factor, how near it is (0–1: its strength), and whether reduced decor keeps it. */
export interface Cloud {
  cell: number;
  alt: number;
  across: number;
  width: number;
  shape: number;
  factor: number;
  near: number;
  core: boolean;
}

/** How likely a cloud at sky t is to be there: 1 up to CLOUD_THIN_FROM, then down to 0 at t 1. */
export function cloudDensity(t: number): number {
  if (!(t > CLOUD_THIN_FROM)) return 1;
  return Math.max(0, (1 - t) / (1 - CLOUD_THIN_FROM));
}

/** A number in [0, 1) for the cell's n-th draw in a layer: the same on every device and every visit. */
function roll(seed: string, layer: CloudLayer, cell: number, n: number): number {
  return mixedHash(`${seed}|${layer}|${cell}|${n}`) / 2 ** 32;
}

const lerp = (range: readonly [number, number], k: number) => range[0] + (range[1] - range[0]) * k;

/** The clouds of altitude cell `cell` in `layer` (0: the horizon to the layer's cell size up), from the household `seed`. */
export function cellClouds(seed: string, cell: number, layer: CloudLayer = 'backdrop'): Cloud[] {
  if (!(cell >= 0) || !Number.isInteger(cell)) return [];
  const spec = LAYERS[layer];
  const first = roll(seed, layer, cell, 0);
  const count = first < spec.counts[0] ? 0 : first < spec.counts[1] ? 1 : 2;
  const shapes = spec.shapes[1] - spec.shapes[0];
  const out: Cloud[] = [];
  let firstAcross = 0;
  for (let j = 0; j < count; j++) {
    const at = (k: number) => roll(seed, layer, cell, 1 + j * 8 + k);
    const alt = (cell + at(0)) * spec.cell;
    // A second cloud in a cell keeps its distance across the sky from the first.
    const across = j === 0 ? at(2) : (firstAcross + 0.35 + 0.3 * at(2)) % 1;
    if (j === 0) firstAcross = across;
    if (alt < CLOUD_MIN_ALT || at(1) >= cloudDensity(skyT(alt))) continue;
    const near = at(3);
    out.push({
      cell,
      alt,
      across,
      factor: lerp(spec.factor, near),
      width: lerp(spec.width, 0.6 * near + 0.4 * at(4)),
      shape: spec.shapes[0] + Math.min(shapes - 1, Math.floor(at(5) * shapes)),
      near,
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
 * camera's altitude is its own. Factor 1: 1:1 with the world; above 1, nearer than the pile.
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

/** The layer a view uses for the clouds behind the pile: the still layer with reduced motion, else the backdrop. */
const behindLayer = (view: Pick<CloudView, 'reduced'>): CloudLayer => (view.reduced ? 'still' : 'backdrop');

/** The altitude cells of `layer` a view can show clouds from: [first, last], or null for none. */
export function cellsInView(view: Pick<CloudView, 'height' | 'horizon' | 'reduced'>, layer: CloudLayer = behindLayer(view)): { first: number; last: number } | null {
  const { height, horizon, reduced } = view;
  if (!(height > 0)) return null;
  const spec = LAYERS[layer];
  // The slowest cloud of the layer reaches furthest up and down the sky.
  const f = reduced ? 1 : spec.factor[0];
  const mid = height / 2;
  // A cloud shows while its base is below the top of the view and its top above the bottom.
  const altAt = (y: number) => (horizon - (mid + (y - mid) / f)) / PX_PER_ALT;
  const lo = Math.max(CLOUD_MIN_ALT, altAt(height + CLOUD_WIDTH[1] * CLOUD_BASE));
  const hi = altAt(0);
  if (!(hi >= lo)) return null;
  return { first: Math.floor(lo / spec.cell), last: Math.floor(hi / spec.cell) };
}

/**
 * The clouds of `layer` to draw this frame, far first: those on screen (and, for a layer drawn
 * before the ground, not wholly behind the horizon), at most the layer's cap for the decor, each
 * faded near the eye line. Empty with decor none, no cell in view, or the foreground with reduced
 * motion. Reduced motion moves every cloud 1:1 with the world.
 */
export function placeClouds(view: CloudView, layer: CloudLayer = behindLayer(view)): PlacedCloud[] {
  const spec = LAYERS[layer];
  const max = view.reduced && layer === 'foreground' ? 0 : spec.max[view.decor];
  if (max <= 0) return [];
  const cells = cellsInView(view, layer);
  if (!cells) return [];
  const { width, height, horizon, reduced } = view;
  const mid = height / 2;
  const out: (PlacedCloud & { middle: number })[] = [];
  for (let cell = cells.first; cell <= cells.last; cell++) {
    for (const cloud of cellClouds(view.seed, cell, layer)) {
      if (view.decor === 'reduced' && spec.halfWhenReduced && !cloud.core) continue;
      const factor = reduced ? 1 : cloud.factor;
      const base = cloudBaseY(cloud.alt, factor, horizon, height);
      const w = cloud.width;
      const y = base - CLOUD_BASE * w;
      if (!(base > 0) || !(y < height)) continue;
      if (spec.behindGround && view.ground && y >= horizon) continue;
      const top = y + shapeTop(CLOUD_SHAPES[cloud.shape]) * w;
      out.push({
        shape: cloud.shape,
        x: (-0.05 + 1.1 * cloud.across) * width - w / 2,
        y,
        width: w,
        height: CLOUD_ASPECT * w,
        alpha: lerp(spec.alpha, cloud.near) * eyeLineFade(top, base, mid, view.eyeReach, reduced),
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
