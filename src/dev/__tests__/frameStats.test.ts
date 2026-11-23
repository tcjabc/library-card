import { describe, expect, it } from 'vitest';
import { FRAME_MS, framesPerSecond, missedFrames } from '../frameStats';

// The book stack prototype's frame timing (src/dev/frameStats.ts).

describe('missedFrames', () => {
  it('counts the frames skipped before a late frame', () => {
    expect(missedFrames(FRAME_MS)).toBe(0);
    expect(missedFrames(20)).toBe(0);
    expect(missedFrames(FRAME_MS * 2)).toBe(1);
    expect(missedFrames(100)).toBe(5);
  });

  it('is 0 for odd inputs', () => {
    expect(missedFrames(0)).toBe(0);
    expect(missedFrames(-5)).toBe(0);
    expect(missedFrames(Number.NaN)).toBe(0);
    expect(missedFrames(50, 0)).toBe(0);
  });
});

describe('framesPerSecond', () => {
  const steady = (from: number, n: number, dt: number) => Array.from({ length: n }, (_, i) => ({ at: from + (i + 1) * dt, dt }));

  it('measures the frames in the window', () => {
    expect(framesPerSecond(steady(0, 120, 1000 / 60), 2000)).toBeCloseTo(60, 5);
    expect(framesPerSecond(steady(0, 60, 1000 / 30), 2000)).toBeCloseTo(30, 5);
  });

  it('ignores frames older than the window', () => {
    const frames = [...steady(0, 10, 100), ...steady(5000, 60, 1000 / 60)];
    expect(framesPerSecond(frames, 6000)).toBeCloseTo(60, 5);
  });

  it('is null with no frames', () => {
    expect(framesPerSecond([], 1000)).toBeNull();
    expect(framesPerSecond(steady(0, 10, 16), 10_000)).toBeNull();
  });
});
