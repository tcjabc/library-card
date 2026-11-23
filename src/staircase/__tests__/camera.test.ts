import { describe, expect, it } from 'vitest';
import {
  EASE_DONE,
  EASE_MS,
  MAX_EASE_DT_MS,
  PX_PER_BOOK,
  clampPosition,
  easeStep,
  positionToScroll,
  scrollHeight,
  scrollToPosition,
  settleTarget,
  stepCamera,
} from '../camera';

// The book stack's eased camera (src/staircase/camera.ts).

describe('scrollToPosition and positionToScroll', () => {
  it('starts at the newest book and goes one book per PX_PER_BOOK', () => {
    expect(scrollToPosition(0, 1000)).toBe(999);
    expect(scrollToPosition(PX_PER_BOOK, 1000)).toBe(998);
    expect(scrollToPosition(PX_PER_BOOK * 2.5, 1000)).toBeCloseTo(996.5, 12);
    expect(positionToScroll(999, 1000)).toBe(0);
    expect(positionToScroll(0, 1000)).toBe(999 * PX_PER_BOOK);
  });

  it('round-trips', () => {
    for (const s of [0, 0.25, 17, 512.75, 999]) expect(scrollToPosition(positionToScroll(s, 1000), 1000)).toBeCloseTo(s, 9);
    for (const top of [0, 13, 5600, 55944]) expect(positionToScroll(scrollToPosition(top, 1000), 1000)).toBeCloseTo(top, 9);
  });

  it('clamps at both ends', () => {
    expect(scrollToPosition(-300, 1000)).toBe(999);
    expect(scrollToPosition(1e9, 1000)).toBe(0);
    expect(positionToScroll(-5, 1000)).toBe(999 * PX_PER_BOOK);
    expect(positionToScroll(4000, 1000)).toBe(0);
    expect(clampPosition(Number.NaN, 10)).toBe(0);
    expect(scrollToPosition(100, 0)).toBe(0);
    expect(scrollToPosition(100, 1)).toBe(0);
  });

  it('sizes the scroll area so the last scroll offset reaches the oldest book', () => {
    const height = scrollHeight(1000, 800);
    expect(height).toBe(999 * PX_PER_BOOK + 800);
    expect(scrollToPosition(height - 800, 1000)).toBe(0);
    expect(scrollHeight(0, 800)).toBe(800);
  });
});

describe('easeStep', () => {
  it('moves 1 - e^(-dt/τ) of the way', () => {
    expect(easeStep(0, 10, 40)).toBeCloseTo(10 * (1 - Math.exp(-40 / EASE_MS)), 12);
    expect(easeStep(0, 10, 200, 100, 1000)).toBeCloseTo(10 * (1 - Math.exp(-2)), 12);
    expect(easeStep(5, 5, 16)).toBe(5);
    expect(easeStep(3, 1, 0)).toBe(3);
  });

  it('converges and never overshoots, in either direction', () => {
    for (const [from, to] of [
      [0, 7.3],
      [12, -4],
    ]) {
      let shown = from;
      for (let frame = 0; frame < 200; frame++) {
        const next = easeStep(shown, to, 16.7);
        expect(Math.abs(to - next)).toBeLessThanOrEqual(Math.abs(to - shown));
        expect(Math.sign(to - next) === Math.sign(to - from) || next === to).toBe(true);
        shown = next;
      }
      expect(shown).toBeCloseTo(to, 9);
    }
  });

  it('caps a long frame at MAX_EASE_DT_MS', () => {
    expect(easeStep(0, 1, 5000)).toBeCloseTo(easeStep(0, 1, MAX_EASE_DT_MS), 12);
    expect(easeStep(0, 1, Number.NaN)).toBe(0);
    expect(easeStep(0, 1, -20)).toBe(0);
  });
});

describe('stepCamera', () => {
  it('snaps onto the target once within EASE_DONE, and says it is done', () => {
    expect(stepCamera(10 - EASE_DONE / 4, 10, 16, false)).toEqual({ shown: 10, done: true });
    const moving = stepCamera(0, 1, 16, false);
    expect(moving.done).toBe(false);
    expect(moving.shown).toBeGreaterThan(0);
    expect(moving.shown).toBeLessThan(1);
  });

  it('arrives within a second at 60 Hz from a whole book away', () => {
    let state = { shown: 0, done: false };
    let frames = 0;
    while (!state.done && frames < 600) {
      state = stepCamera(state.shown, 1, 1000 / 60, false);
      frames += 1;
    }
    expect(state).toEqual({ shown: 1, done: true });
    expect(frames).toBeLessThan(60);
  });

  it('with reduced motion, returns the target at once', () => {
    expect(stepCamera(3, 250.5, 16, true)).toEqual({ shown: 250.5, done: true });
  });
});

describe('settleTarget', () => {
  it('rounds to the nearest whole book, on the pile', () => {
    expect(settleTarget(12.4, 100)).toBe(12);
    expect(settleTarget(12.5, 100)).toBe(13);
    expect(settleTarget(12.6, 100)).toBe(13);
    expect(settleTarget(-3, 100)).toBe(0);
    expect(settleTarget(140, 100)).toBe(99);
    expect(settleTarget(98.7, 100)).toBe(99);
  });
});
