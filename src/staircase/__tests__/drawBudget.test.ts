import { describe, expect, it } from 'vitest';
import {
  FAN_CAP,
  INSET_EVERY,
  LOD_DISTANCE,
  LOD_MIN_PX,
  MIN_FRAMES_TO_DECIDE,
  SLOW_FRAME_MS,
  faceSpan,
  faceThickness,
  insetDue,
  nextScale,
  pageDetail,
  tagChanged,
  visibleRange,
} from '../drawBudget';
import type { ProjectedFace } from '../stackProjection';

// The canvas stack's per-frame budget (src/staircase/drawBudget.ts).

describe('visibleRange', () => {
  // Books 40..60 are on screen.
  const onScreen = (i: number) => i >= 40 && i <= 60;

  it('takes the books on screen plus one spare each way', () => {
    expect(visibleRange(50, 1000, onScreen)).toEqual({ start: 39, end: 62 });
    expect(visibleRange(50, 1000, onScreen, 0)).toEqual({ start: 40, end: 61 });
    expect(visibleRange(50, 1000, onScreen, 3)).toEqual({ start: 37, end: 64 });
  });

  it('never goes past the cap either side', () => {
    expect(visibleRange(500, 1000, () => true)).toEqual({ start: 500 - FAN_CAP, end: 500 + FAN_CAP + 1 });
    expect(visibleRange(500, 1000, () => true, 1, 5)).toEqual({ start: 495, end: 506 });
  });

  it('stays on the pile at both ends, and always keeps the centre book', () => {
    expect(visibleRange(0, 1000, (i) => i <= 6)).toEqual({ start: 0, end: 8 });
    expect(visibleRange(999, 1000, (i) => i >= 993)).toEqual({ start: 992, end: 1000 });
    expect(visibleRange(3, 5, () => true)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(10, 100, () => false)).toEqual({ start: 9, end: 12 });
    expect(visibleRange(10.4, 100, () => false, 0)).toEqual({ start: 10, end: 11 });
    expect(visibleRange(0, 0, () => true)).toEqual({ start: 0, end: 0 });
  });

  it('asks about each book at most once, and stops at the first off screen', () => {
    const asked: number[] = [];
    visibleRange(50, 1000, (i) => {
      asked.push(i);
      return onScreen(i);
    });
    expect(new Set(asked).size).toBe(asked.length);
    expect(Math.max(...asked)).toBe(61);
    expect(Math.min(...asked)).toBe(39);
  });
});

const face = (origin: [number, number], u: [number, number], v: [number, number]): ProjectedFace => ({
  side: 'right',
  origin: { x: origin[0], y: origin[1] },
  u: { x: u[0], y: u[1] },
  v: { x: v[0], y: v[1] },
  width: 1,
  height: 1,
});

describe('faceSpan and faceThickness', () => {
  it('spans the faces’ corners top to bottom', () => {
    expect(faceSpan([face([0, 10], [5, -4], [0, 20]), face([3, 0], [2, 2], [1, 40])])).toEqual({ top: 0, bottom: 42 });
  });

  it('is the short side of a rectangle, and the true thinness of a slanted one', () => {
    expect(faceThickness(face([0, 0], [100, 0], [0, 30]))).toBe(30);
    expect(faceThickness(face([0, 0], [4, 0], [0, 30]))).toBe(4);
    // A long thin sliver, slanted: area 20 × 3 over its longest edge (≈20.2).
    expect(faceThickness(face([0, 0], [20, 3], [0, 3]))).toBeCloseTo((20 * 3) / Math.hypot(20, 3), 9);
    expect(faceThickness(face([0, 0], [0, 0], [0, 0]))).toBe(0);
  });
});

describe('pageDetail', () => {
  it('stripes the page edges near the camera and flattens them further away', () => {
    expect(pageDetail(0, 30)).toBe('striped');
    expect(pageDetail(LOD_DISTANCE, 30)).toBe('striped');
    expect(pageDetail(-LOD_DISTANCE, 30)).toBe('striped');
    expect(pageDetail(LOD_DISTANCE + 0.01, 30)).toBe('flat');
    expect(pageDetail(-9, 30)).toBe('flat');
  });

  it('flattens faces thinner than LOD_MIN_PX on screen, even up close', () => {
    expect(pageDetail(1, LOD_MIN_PX - 0.1)).toBe('flat');
    expect(pageDetail(1, LOD_MIN_PX)).toBe('striped');
  });
});

describe('insetDue and tagChanged', () => {
  it('draws the inset the first time, then only when the centre or the whole-degree angle changes', () => {
    expect(insetDue(null, { centre: 5, angle: 50, frame: 0 })).toBe(true);
    const last = { centre: 5, angle: 50.2, frame: 10 };
    expect(insetDue(last, { centre: 5, angle: 50.4, frame: 20 })).toBe(false);
    expect(insetDue(last, { centre: 5, angle: 51.1, frame: 20 })).toBe(true);
    expect(insetDue(last, { centre: 6, angle: 50.2, frame: 20 })).toBe(true);
  });

  it('never redraws the inset on two frames running', () => {
    const last = { centre: 5, angle: 50, frame: 10 };
    expect(insetDue(last, { centre: 9, angle: 90, frame: 10 + INSET_EVERY - 1 })).toBe(false);
    expect(insetDue(last, { centre: 9, angle: 90, frame: 10 + INSET_EVERY })).toBe(true);
  });

  it('gives the tag new text only for a new book or a new whole degree', () => {
    expect(tagChanged(null, 3, 0)).toBe(true);
    expect(tagChanged({ step: 3, degrees: 4 }, 3, 4)).toBe(false);
    expect(tagChanged({ step: 3, degrees: 4 }, 3, 5)).toBe(true);
    expect(tagChanged({ step: 3, degrees: 4 }, 4, 4)).toBe(true);
  });
});

describe('nextScale', () => {
  const slow = SLOW_FRAME_MS + 5;

  it('steps down 2 → 1.5 → 1.25 → 1 while frames are slow, and stops at 1', () => {
    expect(nextScale(2, slow)).toBe(1.5);
    expect(nextScale(1.5, slow)).toBe(1.25);
    expect(nextScale(1.25, slow)).toBe(1);
    expect(nextScale(1, slow)).toBe(1);
    expect(nextScale(1.75, slow)).toBe(1.5);
  });

  it('never steps up, and keeps the scale when frames are fast enough', () => {
    expect(nextScale(1.25, 8)).toBe(1.25);
    expect(nextScale(2, SLOW_FRAME_MS)).toBe(2);
    expect(nextScale(2, 16.7)).toBe(2);
    expect(nextScale(1, 5)).toBe(1);
  });

  it('waits for enough frames before deciding', () => {
    expect(nextScale(2, slow, MIN_FRAMES_TO_DECIDE - 1)).toBe(2);
    expect(nextScale(2, slow, MIN_FRAMES_TO_DECIDE)).toBe(1.5);
  });

  it('copes with odd inputs', () => {
    expect(nextScale(2, Number.NaN)).toBe(2);
    expect(nextScale(0, slow)).toBe(1);
    expect(nextScale(0.75, slow)).toBe(1);
  });
});
