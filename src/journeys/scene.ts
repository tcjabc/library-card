import type { Decor } from '../staircase/drawBudget';
import type { JourneyDirection, JourneyId } from './journeys';

/**
 * Journey scenes (pure, unit-tested): a flat picture behind the journey track
 * in three depth layers (far, mid, near) that slide by different amounts as the
 * reader moves along the track, a parallax feel (src/screens/journeys/
 * JourneyScene.tsx draws them; docs/journeys.md). The step rows stay put: only
 * the picture moves.
 *
 * One value drives every layer: the shift, 0 to 1, how far down the journey
 * page the reader has scrolled (0: the top end of the track, 1: the bottom end;
 * the track is the page's length). On a page too short to scroll much, it's
 * where the reader's step sits instead (stepShift). Each layer is
 * taller than the view by its travel (its factor × the scene's travel, px) and
 * moves up by shift × travel, so at the top end of the track its top shows and
 * at the bottom end its bottom. A rising journey starts at the bottom, so as the
 * reader climbs the world moves down; Ocean Deep starts at the top, so as they
 * dive it moves up. Far layers move least, near ones most.
 */

export type SceneLayer = 'far' | 'mid' | 'near';
/** Back to front, the order they're drawn. */
export const SCENE_LAYERS = ['far', 'mid', 'near'] as const satisfies readonly SceneLayer[];

export interface SceneConfig {
  /** How far (px) a layer with factor 1 moves from one end of the track to the other. */
  travel: number;
  /** Each layer's share of the travel: far least, near most. */
  factors: Record<SceneLayer, number>;
}

/** The longest travel any scene may have (px), so a long journey never slides its picture off. */
export const MAX_TRAVEL = 640;
/** The biggest layer factor allowed. */
export const MAX_FACTOR = 1.5;

/** The journeys with a scene; the others keep their plain track. */
export const SCENES: Partial<Record<JourneyId, SceneConfig>> = {
  hot_air_balloon: { travel: 640, factors: { far: 0.2, mid: 0.6, near: 1 } },
  ocean_deep: { travel: 200, factors: { far: 0.2, mid: 0.5, near: 1 } },
  redwood_tree: { travel: 300, factors: { far: 0.2, mid: 0.6, near: 1 } },
  ocean_cliff: { travel: 360, factors: { far: 0.2, mid: 0.6, near: 1 } },
  skyscraper: { travel: 420, factors: { far: 0.2, mid: 0.6, near: 1 } },
};

export function sceneFor(id: string): SceneConfig | null {
  return (SCENES as Record<string, SceneConfig | undefined>)[id] ?? null;
}

const clamp = (value: number, lo: number, hi: number) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo);

/** How far (px) a layer moves over the whole track: its factor (clamped) × the scene's travel (clamped). */
export function layerTravel(config: SceneConfig, layer: SceneLayer): number {
  return clamp(config.factors[layer], 0, MAX_FACTOR) * clamp(config.travel, 0, MAX_TRAVEL);
}

/** The layer's offset on screen (px, negative = up) at `shift` (0–1, clamped). */
export function layerOffset(shift: number, travel: number): number {
  return -clamp(shift, 0, 1) * Math.max(0, travel);
}

/**
 * How much the scene follows the scroll, by how far the page can scroll (× the
 * view's height): not at all up to the first, fully from the second, a smooth
 * mix in between (so a phone's browser bar sliding away, which changes the view's
 * height a little, never makes the scene jump).
 */
export const SCROLL_BLEND = [0.25, 0.75] as const;

/**
 * The shift from the page's scroll: `scrollTop` over the `range` it can scroll
 * (its height less the view's), clamped, mixed with `fallback` (the reader's
 * step's shift) on a page that can barely scroll (SCROLL_BLEND).
 */
export function scrollShift(scrollTop: number, range: number, viewHeight: number, fallback: number): number {
  const still = clamp(fallback, 0, 1);
  if (!(range > 0) || !(viewHeight > 0)) return still;
  const follow = clamp((range / viewHeight - SCROLL_BLEND[0]) / (SCROLL_BLEND[1] - SCROLL_BLEND[0]), 0, 1);
  return follow * clamp(scrollTop / range, 0, 1) + (1 - follow) * still;
}

/**
 * The shift with step `step` (0: the start row) in the middle of the view, if
 * the rows were all the same height: the track has the finish row, the steps
 * and the start row, the finish at the top for rising journeys and at the
 * bottom for Ocean Deep.
 */
export function stepShift(step: number, steps: number, direction: JourneyDirection): number {
  if (!(steps > 0)) return 0;
  const rows = steps + 2;
  const s = clamp(Math.round(step), 0, steps);
  // Row index from the top: rising journeys list finish, steps n..1, start; down ones start, 1..n, finish.
  const index = direction === 'down' ? s : steps + 1 - s;
  return clamp((index + 0.5) / rows, 0, 1);
}

/** A step change always glides the near layer at least this far (px), so even one step of a long journey shows. */
export const MIN_SETTLE_PX = 60;

/**
 * How far (px) each layer starts away from where it settles when the reader's step changed from
 * `from` to `to`: the near layer by where the two steps put it, but at least MIN_SETTLE_PX and at
 * most its travel; far and mid by the same glide scaled by their factors. None when the step is
 * the same.
 */
export function settleOffsets(from: number, to: number, steps: number, direction: JourneyDirection, config: SceneConfig): Record<SceneLayer, number> {
  const nearTravel = layerTravel(config, 'near');
  const proportional = layerOffset(stepShift(from, steps, direction), nearTravel) - layerOffset(stepShift(to, steps, direction), nearTravel);
  const nearFactor = clamp(config.factors.near, 0, MAX_FACTOR);
  if (proportional === 0 || !(nearTravel > 0) || !(nearFactor > 0)) return { far: 0, mid: 0, near: 0 };
  const near = Math.sign(proportional) * Math.min(nearTravel, Math.max(Math.abs(proportional), MIN_SETTLE_PX));
  const scaled = (layer: SceneLayer) => (near * clamp(config.factors[layer], 0, MAX_FACTOR)) / nearFactor;
  return { far: scaled('far'), mid: scaled('mid'), near };
}

/** How long the settle after a step change takes (ms). */
export const SETTLE_MS = 1200;

/** What the scene does: ambient loops, follow the scroll (parallax), and the one-time settle after a step change. */
export interface SceneMotion {
  loops: boolean;
  parallax: boolean;
  settle: boolean;
}

/**
 * From the device's Sky decoration level and the system's reduced motion: Full
 * = loops and parallax; Reduced = parallax only; None, or reduced motion, = a
 * still picture (no loops, no parallax, no settle).
 */
export function sceneMotion(decor: Decor, reducedMotion: boolean): SceneMotion {
  if (reducedMotion || decor === 'none') return { loops: false, parallax: false, settle: false };
  return { loops: decor === 'full', parallax: true, settle: true };
}

/** The most looping (animated) shapes a scene may have, so an old tablet keeps up. */
export const MAX_LOOPS = 15;
