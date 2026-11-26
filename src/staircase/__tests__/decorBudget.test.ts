import { describe, expect, it } from 'vitest';
import {
  DECOR_LEVELS,
  MIN_FRAMES_TO_DECIDE,
  PRETEND_SLOW_FRAME_MS,
  SLOW_FRAME_MS,
  budgetFrameMs,
  decorInEffect,
  lowerDecor,
  minDecor,
  nextBudget,
  type Budget,
} from '../drawBudget';
import { DEFAULT_DECOR, parseDecor } from '../decorSetting';

const SLOW = SLOW_FRAME_MS + 10;
const FAST = SLOW_FRAME_MS - 6;

describe('decor levels', () => {
  it('go none < reduced < full', () => {
    expect(DECOR_LEVELS).toEqual(['none', 'reduced', 'full']);
    expect(minDecor('full', 'reduced')).toBe('reduced');
    expect(minDecor('none', 'full')).toBe('none');
    expect(lowerDecor('full')).toBe('reduced');
    expect(lowerDecor('reduced')).toBe('none');
    expect(lowerDecor('none')).toBe('none');
  });

  it('the setting reads back what was stored, full otherwise', () => {
    expect(DEFAULT_DECOR).toBe('full');
    expect(parseDecor('reduced')).toBe('reduced');
    expect(parseDecor('none')).toBe('none');
    expect(parseDecor(null)).toBe('full');
    expect(parseDecor('lots')).toBe('full');
  });
});

describe('nextBudget: decor drops out before the resolution', () => {
  it('slow frames lower decor first (full → reduced → none), and only then the scale (2 → 1.5 → 1.25 → 1)', () => {
    let b: Budget = { decor: 'full', scale: 2 };
    const seen: Budget[] = [];
    for (let k = 0; k < 7; k++) {
      b = nextBudget(b, SLOW, MIN_FRAMES_TO_DECIDE);
      seen.push(b);
    }
    expect(seen).toEqual([
      { decor: 'reduced', scale: 2 },
      { decor: 'none', scale: 2 },
      { decor: 'none', scale: 1.5 },
      { decor: 'none', scale: 1.25 },
      { decor: 'none', scale: 1 },
      { decor: 'none', scale: 1 },
      { decor: 'none', scale: 1 },
    ]);
  });

  it('with no decor to lose (clouds off, or the setting already none), the scale steps down straight away', () => {
    expect(nextBudget({ decor: 'none', scale: 2 }, SLOW)).toEqual({ decor: 'none', scale: 1.5 });
    expect(nextBudget({ decor: 'reduced', scale: 1.5 }, SLOW)).toEqual({ decor: 'none', scale: 1.5 });
  });

  it('fast frames, or too few frames to tell, change nothing; it never goes back up', () => {
    const slowed = nextBudget({ decor: 'full', scale: 2 }, SLOW);
    expect(nextBudget(slowed, FAST)).toEqual(slowed);
    expect(nextBudget(slowed, 2)).toEqual(slowed);
    expect(nextBudget({ decor: 'full', scale: 2 }, SLOW, MIN_FRAMES_TO_DECIDE - 1)).toEqual({ decor: 'full', scale: 2 });
    expect(nextBudget({ decor: 'full', scale: 2 }, Number.NaN)).toEqual({ decor: 'full', scale: 2 });
  });

  it('a scale of 1 (a desktop screen) still loses its decor', () => {
    expect(nextBudget({ decor: 'full', scale: 1 }, SLOW)).toEqual({ decor: 'reduced', scale: 1 });
    expect(nextBudget({ decor: 'none', scale: 1 }, SLOW)).toEqual({ decor: 'none', scale: 1 });
  });
});

describe('decorInEffect: the least of the setting, the per-visit cap and reduced motion', () => {
  it('is min(setting, cap)', () => {
    for (const setting of DECOR_LEVELS) {
      for (const cap of DECOR_LEVELS) expect(decorInEffect(setting, cap, false).decor).toBe(minDecor(setting, cap));
    }
  });

  it('says why', () => {
    expect(decorInEffect('full', 'full', false)).toEqual({ decor: 'full', why: 'setting' });
    expect(decorInEffect('full', 'reduced', false)).toEqual({ decor: 'reduced', why: 'slow' });
    expect(decorInEffect('reduced', 'reduced', false)).toEqual({ decor: 'reduced', why: 'setting' });
    expect(decorInEffect('full', 'full', true)).toEqual({ decor: 'reduced', why: 'motion' });
    expect(decorInEffect('full', 'none', true)).toEqual({ decor: 'none', why: 'slow' });
    expect(decorInEffect('none', 'full', true)).toEqual({ decor: 'none', why: 'setting' });
  });

  it('reduced motion caps decor at reduced', () => {
    for (const setting of DECOR_LEVELS) expect(decorInEffect(setting, 'full', true).decor).toBe(minDecor(setting, 'reduced'));
  });
});

describe('"Pretend slow frames"', () => {
  it('makes every frame count as at least PRETEND_SLOW_FRAME_MS for the budget, which is slow', () => {
    expect(budgetFrameMs(16.7, false)).toBe(16.7);
    expect(budgetFrameMs(16.7, true)).toBe(PRETEND_SLOW_FRAME_MS);
    expect(budgetFrameMs(60, true)).toBe(60);
    expect(PRETEND_SLOW_FRAME_MS).toBeGreaterThan(SLOW_FRAME_MS);
  });
});
