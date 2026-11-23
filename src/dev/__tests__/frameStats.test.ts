import { describe, expect, it } from 'vitest';
import { FRAME_MS, framesPerSecond, missedFrames, rendersPerSecond } from '../frameStats';

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

describe('rendersPerSecond', () => {
  const frames = (from: number, n: number, dt: number, renders: (i: number) => number | undefined) =>
    Array.from({ length: n }, (_, i) => ({ at: from + (i + 1) * dt, dt, renders: renders(i) }));

  it('adds up the renders over the frames in the window', () => {
    // 100 frames of 20 ms (2 s), 3 renders every 10th frame: 30 renders in 2 s.
    expect(rendersPerSecond(frames(0, 100, 20, (i) => (i % 10 === 0 ? 3 : 0)), 2000)).toBeCloseTo(15, 5);
  });

  it('is 0 when nothing rendered, and ignores old, missing or odd counts', () => {
    expect(rendersPerSecond(frames(0, 50, 20, () => 0), 1000)).toBe(0);
    expect(rendersPerSecond(frames(0, 50, 20, () => undefined), 1000)).toBe(0);
    expect(rendersPerSecond(frames(0, 50, 20, () => -4), 1000)).toBe(0);
    const old = frames(0, 10, 100, () => 50);
    expect(rendersPerSecond([...old, ...frames(5000, 50, 20, () => 0)], 6000)).toBe(0);
  });

  it('is null with no frames', () => {
    expect(rendersPerSecond([], 1000)).toBeNull();
  });
});
