import { budgetDue, budgetFrameMs, decorRank, minDecor, nextBudget, type Decor } from '../staircase/drawBudget';

/**
 * A journey scene's per-visit motion budget (pure, unit-tested; docs/journeys.md, "Slow devices").
 * The same rule as the Family Staircase's pile (drawBudget.ts: budgetDue, nextBudget, SLOW_FRAME_MS):
 * after about a second of measured frames (at least DECIDE_AFTER_MS over at least
 * MIN_FRAMES_TO_DECIDE frames, so a device under 30 frames a second still gets a verdict), frames
 * averaging slower than SLOW_FRAME_MS lower the scene's motion one level for the rest of the visit:
 * Full (ambient loops and parallax) → Reduced (parallax only) → None (a still scene at the reader's
 * step). It never goes back up within the visit, and the Sky decoration setting is never changed:
 * the next visit starts from the setting again.
 */

/** This visit's budget: the cap on the motion level, and the frames measured since the last decision. */
export interface SceneBudget {
  cap: Decor;
  frames: number;
  /** Time over those frames (ms). */
  motionMs: number;
  /** The time the budget hears ("Pretend slow frames" makes it more; drawBudget.budgetFrameMs). */
  costMs: number;
}

/** A new visit: no cap yet. */
export const FRESH_SCENE_BUDGET: SceneBudget = { cap: 'full', frames: 0, motionMs: 0, costMs: 0 };

/**
 * A gap between two frames longer than this (ms) is a pause (the tab was hidden, the page was
 * frozen), not a slow frame, and isn't counted. A device that slow would be at 2 frames a second.
 */
export const FRAME_BREAK_MS = 500;

/**
 * The budget after one more measured frame of `dt` ms, with `shown` the level in effect now: when a
 * decision is due and the frames were slow, the cap goes one level below what's shown (as the pile
 * lowers its decor), and the count starts again either way. Nothing to lower at None.
 */
export function sceneFrame(budget: SceneBudget, dt: number, shown: Decor, pretendSlow: boolean): SceneBudget {
  if (!(dt > 0) || dt > FRAME_BREAK_MS) return budget;
  const frames = budget.frames + 1;
  const motionMs = budget.motionMs + dt;
  const costMs = budget.costMs + budgetFrameMs(dt, pretendSlow);
  if (!budgetDue(motionMs, frames)) return { ...budget, frames, motionMs, costMs };
  const next = nextBudget({ decor: shown, scale: 1 }, costMs / frames, frames).decor;
  return { cap: decorRank(next) < decorRank(shown) ? minDecor(budget.cap, next) : budget.cap, frames: 0, motionMs: 0, costMs: 0 };
}

/** Why the scene's motion level is what it is: the device's setting, slow frames this visit, or reduced motion. */
export type SceneMotionWhy = 'setting' | 'slow' | 'motion';

/**
 * The scene's motion level: the least of the Sky decoration setting and this visit's cap, or None
 * (a still scene) with the system's reduced motion; and why (the setting first when they tie).
 */
export function sceneLevel(setting: Decor, cap: Decor, reducedMotion: boolean): { level: Decor; why: SceneMotionWhy } {
  const level: Decor = reducedMotion ? 'none' : minDecor(setting, cap);
  if (level === setting) return { level, why: 'setting' };
  return { level, why: reducedMotion ? 'motion' : 'slow' };
}

/** How long frames are measured after the screen opens with ambient loops running (ms). */
export const OPEN_SAMPLE_MS = 3000;
/** How long after the last scroll event frames are still measured (ms): the scroll's own tail. */
export const SCROLL_SAMPLE_MS = 250;
/** Extra time measured after the settle's glide (ms). */
export const SETTLE_SAMPLE_EXTRA_MS = 200;
