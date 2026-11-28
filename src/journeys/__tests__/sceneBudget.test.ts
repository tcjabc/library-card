import { describe, expect, it } from 'vitest';
import { DECIDE_AFTER_MS, MIN_FRAMES_TO_DECIDE, PRETEND_SLOW_FRAME_MS, SLOW_FRAME_MS, type Decor } from '../../staircase/drawBudget';
import { FRAME_BREAK_MS, FRESH_SCENE_BUDGET, sceneFrame, sceneLevel, type SceneBudget } from '../sceneBudget';
import { sceneMotion } from '../scene';

// 1.21.0: a journey scene lowers its motion on slow devices for the rest of the visit, by the same
// rule as the Family Staircase's pile (drawBudget.ts).

/** Feeds `count` frames of `dt` ms, the shown level following the cap (as the screen does). */
function run(budget: SceneBudget, dt: number, count: number, setting: Decor = 'full', pretendSlow = false): SceneBudget {
  let b = budget;
  for (let i = 0; i < count; i++) b = sceneFrame(b, dt, sceneLevel(setting, b.cap, false).level, pretendSlow);
  return b;
}

describe('sceneFrame: the per-visit cap', () => {
  it('a device holding 60 frames a second keeps Full, however long it scrolls', () => {
    expect(run(FRESH_SCENE_BUDGET, 1000 / 60, 600).cap).toBe('full');
    expect(run(FRESH_SCENE_BUDGET, SLOW_FRAME_MS, 600).cap).toBe('full');
  });

  it('slow frames step down a level per decision (about a second each): Full → Reduced → None', () => {
    const second = Math.ceil(DECIDE_AFTER_MS / 30);
    const once = run(FRESH_SCENE_BUDGET, 30, second);
    expect(once.cap).toBe('reduced');
    expect(once.frames).toBe(0);
    expect(run(once, 30, second).cap).toBe('none');
  });

  it('no verdict before the stack’s minimum of a second over 30 frames', () => {
    expect(run(FRESH_SCENE_BUDGET, 30, 33).cap).toBe('full'); // 990 ms
    expect(run(FRESH_SCENE_BUDGET, 30, 34).cap).toBe('reduced');
  });

  it('a device under 30 frames a second does get a verdict (it waits for 30 frames, then drops)', () => {
    const b = run(FRESH_SCENE_BUDGET, 50, MIN_FRAMES_TO_DECIDE - 1);
    expect(b.cap).toBe('full');
    expect(b.motionMs).toBeGreaterThan(DECIDE_AFTER_MS);
    expect(run(b, 50, 1).cap).toBe('reduced');
  });

  it('never goes back up within the visit', () => {
    const lowered = run(FRESH_SCENE_BUDGET, 40, 30);
    expect(lowered.cap).toBe('reduced');
    expect(run(lowered, 1000 / 60, 600).cap).toBe('reduced');
  });

  it('steps down from what is shown: with the setting at Reduced, slow frames go straight to None', () => {
    expect(run(FRESH_SCENE_BUDGET, 40, 30, 'reduced').cap).toBe('none');
  });

  it('at None there is nothing to lower', () => {
    expect(run({ ...FRESH_SCENE_BUDGET, cap: 'none' }, 40, 300, 'full').cap).toBe('none');
    expect(run(FRESH_SCENE_BUDGET, 40, 300, 'none').cap).toBe('full');
  });

  it('a pause is not a slow frame (a hidden tab, a frozen page): gaps over FRAME_BREAK_MS are not counted', () => {
    const b = run(FRESH_SCENE_BUDGET, FRAME_BREAK_MS + 1, 100);
    expect(b).toEqual(FRESH_SCENE_BUDGET);
    expect(sceneFrame(FRESH_SCENE_BUDGET, 0, 'full', false)).toBe(FRESH_SCENE_BUDGET);
    expect(sceneFrame(FRESH_SCENE_BUDGET, Number.NaN, 'full', false)).toBe(FRESH_SCENE_BUDGET);
  });

  it('“Pretend slow frames” makes fast frames count as slow', () => {
    expect(PRETEND_SLOW_FRAME_MS).toBeGreaterThan(SLOW_FRAME_MS);
    expect(run(FRESH_SCENE_BUDGET, 1000 / 60, 61, 'full', true).cap).toBe('reduced');
    expect(run(FRESH_SCENE_BUDGET, 1000 / 60, 122, 'full', true).cap).toBe('none');
  });
});

describe('sceneLevel: the setting, this visit’s cap and reduced motion', () => {
  it('the least of the setting and the cap, and why', () => {
    expect(sceneLevel('full', 'full', false)).toEqual({ level: 'full', why: 'setting' });
    expect(sceneLevel('full', 'reduced', false)).toEqual({ level: 'reduced', why: 'slow' });
    expect(sceneLevel('reduced', 'full', false)).toEqual({ level: 'reduced', why: 'setting' });
    expect(sceneLevel('reduced', 'none', false)).toEqual({ level: 'none', why: 'slow' });
    expect(sceneLevel('none', 'reduced', false)).toEqual({ level: 'none', why: 'setting' });
  });

  it('reduced motion is always a still scene, whatever the setting and the cap', () => {
    expect(sceneLevel('full', 'full', true)).toEqual({ level: 'none', why: 'motion' });
    expect(sceneLevel('reduced', 'reduced', true)).toEqual({ level: 'none', why: 'motion' });
    expect(sceneLevel('none', 'full', true)).toEqual({ level: 'none', why: 'setting' });
  });

  it('each level is the motion it names: Full loops and parallax, Reduced parallax only, None still', () => {
    expect(sceneMotion(sceneLevel('full', 'full', false).level, false)).toEqual({ loops: true, parallax: true, settle: true });
    expect(sceneMotion(sceneLevel('full', 'reduced', false).level, false)).toEqual({ loops: false, parallax: true, settle: true });
    expect(sceneMotion(sceneLevel('full', 'none', false).level, false)).toEqual({ loops: false, parallax: false, settle: false });
  });
});
