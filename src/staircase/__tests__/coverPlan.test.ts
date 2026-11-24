import { describe, expect, it } from 'vitest';
import { FAN_CAP, LOD_MIN_PX } from '../drawBudget';
import {
  COLOUR_NEAR,
  COVER_MIN_PX,
  KEEP_DISTANCE,
  LOOK_AHEAD,
  LOOK_BEHIND,
  PICTURE_CAP,
  REST_SPARE,
  SLICE_MIN_MS,
  coverJobs,
  evictions,
  fadeProgress,
  fadeStart,
  outward,
  showsPicture,
  sliceHasRoom,
  travelOf,
  worthKeeping,
  type KeptPicture,
} from '../coverPlan';

// Which covers the Family Staircase draws, loads ahead, keeps and fades in (src/staircase/coverPlan.ts).

describe('showsPicture (the draw range)', () => {
  it('shows the cover on every drawn top face that is big enough, however far from the camera', () => {
    expect(COVER_MIN_PX).toBe(LOD_MIN_PX);
    expect(showsPicture(COVER_MIN_PX)).toBe(true);
    expect(showsPicture(40)).toBe(true);
  });

  it('keeps very thin (far or edge-on) faces flat', () => {
    expect(showsPicture(COVER_MIN_PX - 0.01)).toBe(false);
    expect(showsPicture(0)).toBe(false);
  });
});

describe('travelOf', () => {
  it('is the way the camera is going, or at rest', () => {
    expect(travelOf(10, 12)).toBe(1);
    expect(travelOf(10, 8.5)).toBe(-1);
    expect(travelOf(10, 10)).toBe(0);
    expect(travelOf(10, 10.005)).toBe(0);
  });
});

describe('outward', () => {
  it('lists every book nearest first, ties down the pile at rest', () => {
    expect(outward(3, 7, 0)).toEqual([3, 2, 4, 1, 5, 0, 6]);
  });

  it('breaks ties the way the camera travels', () => {
    expect(outward(3, 7, 1)).toEqual([3, 4, 2, 5, 1, 6, 0]);
    expect(outward(3, 7, -1)).toEqual([3, 2, 4, 1, 5, 0, 6]);
  });

  it('runs on past either end of the pile', () => {
    expect(outward(0, 4, 0)).toEqual([0, 1, 2, 3]);
    expect(outward(9, 4, 0)).toEqual([3, 2, 1, 0]);
    expect(outward(0, 0, 0)).toEqual([]);
  });
});

describe('coverJobs (look-ahead and the colour queue)', () => {
  const pictures = (jobs: ReturnType<typeof coverJobs>) => jobs.filter((j) => j.picture).map((j) => j.index);
  const colours = (jobs: ReturnType<typeof coverJobs>) => jobs.filter((j) => !j.picture).map((j) => j.index);

  it('asks for the drawn books first, nearest first', () => {
    const jobs = coverJobs(50, 46, 55, 1000, 0);
    expect(jobs.slice(0, 9).map((j) => j.index)).toEqual([50, 49, 51, 48, 52, 47, 53, 46, 54]);
    expect(jobs.slice(0, 9).every((j) => j.picture)).toBe(true);
  });

  it('moving up: pictures for LOOK_AHEAD books above the drawn ones, then LOOK_BEHIND below', () => {
    const jobs = coverJobs(50, 46, 55, 1000, 1);
    const extra = pictures(jobs).slice(9);
    expect(extra).toEqual([55, 56, 57, 58, 59, 60, 45, 44]);
    expect(extra).toHaveLength(LOOK_AHEAD + LOOK_BEHIND);
  });

  it('moving down: LOOK_AHEAD below, then LOOK_BEHIND above', () => {
    const extra = pictures(coverJobs(50, 46, 55, 1000, -1)).slice(9);
    expect(extra).toEqual([45, 44, 43, 42, 41, 40, 55, 56]);
  });

  it('at rest: REST_SPARE each way, nearest first', () => {
    const extra = pictures(coverJobs(50, 46, 55, 1000, 0)).slice(9);
    expect(extra).toEqual([45, 55, 44, 56, 43, 57]);
    expect(extra).toHaveLength(2 * REST_SPARE);
  });

  it('then colours outwards: the whole pile at rest, nearest first, each book once', () => {
    const jobs = coverJobs(50, 46, 55, 1000, 0);
    const c = colours(jobs);
    expect(c.slice(0, 4)).toEqual([42, 58, 41, 59]);
    expect(new Set(jobs.map((j) => j.index)).size).toBe(1000);
    expect(jobs).toHaveLength(1000);
    // Nearest first all the way out.
    const d = c.map((i) => Math.abs(i - 50));
    expect(d.every((x, k) => k === 0 || x >= d[k - 1])).toBe(true);
  });

  it('while moving, colours stop at the COLOUR_NEAR nearest books (the rest follow at rest)', () => {
    const jobs = coverJobs(500, 496, 505, 1000, 1);
    expect(jobs.length).toBeLessThanOrEqual(COLOUR_NEAR + LOOK_AHEAD + LOOK_BEHIND);
    expect(Math.max(...jobs.map((j) => Math.abs(j.index - 500)))).toBeLessThanOrEqual(COLOUR_NEAR / 2);
  });

  it('when the pile opens: the nearest ~60 colours come before anything further', () => {
    const jobs = coverJobs(999, 985, 1000, 1000, 0);
    const firstSixty = jobs.slice(0, COLOUR_NEAR).map((j) => j.index);
    expect(Math.min(...firstSixty)).toBe(999 - (COLOUR_NEAR - 1));
  });

  it('stays inside the pile', () => {
    const jobs = coverJobs(1, 0, 4, 5, -1);
    expect(jobs.map((j) => j.index).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(coverJobs(0, 0, 0, 0, 0)).toEqual([]);
  });
});

describe('sliceHasRoom (the cap per idle slice)', () => {
  it('stops at the cap', () => {
    expect(sliceHasRoom(0, 2, 10)).toBe(true);
    expect(sliceHasRoom(1, 2, 10)).toBe(true);
    expect(sliceHasRoom(2, 2, 10)).toBe(false);
  });

  it('stops when the slice is nearly out of time', () => {
    expect(sliceHasRoom(0, 2, SLICE_MIN_MS)).toBe(false);
    expect(sliceHasRoom(0, 2, 0)).toBe(false);
  });
});

describe('evictions', () => {
  const kept = (n: number, f: (i: number) => Partial<KeptPicture>): KeptPicture[] =>
    Array.from({ length: n }, (_, i) => ({ key: `k${i}`, distance: i, drawn: false, used: i, ...f(i) }));

  it('releases nothing at or under the cap', () => {
    expect(PICTURE_CAP).toBe(48);
    expect(evictions(kept(PICTURE_CAP, (i) => ({ distance: 100 + i })))).toEqual([]);
  });

  it('over the cap, releases only books further than KEEP_DISTANCE, furthest first, just enough', () => {
    const pics = kept(PICTURE_CAP + 2, (i) => ({ distance: i }));
    expect(evictions(pics)).toEqual([`k${PICTURE_CAP + 1}`, `k${PICTURE_CAP}`]);
  });

  it('keeps everything within KEEP_DISTANCE even over the cap', () => {
    const pics = kept(PICTURE_CAP + 5, (i) => ({ distance: i % (KEEP_DISTANCE + 1) }));
    expect(evictions(pics)).toEqual([]);
  });

  it('never releases a drawn book', () => {
    const pics = kept(PICTURE_CAP + 1, (i) => ({ distance: i === 0 ? 500 : 1, drawn: i === 0 }));
    expect(evictions(pics)).toEqual([]);
  });

  it('among equally far books, the least recently used goes first; gone books (Infinity) before anything', () => {
    const pics = kept(PICTURE_CAP + 2, (i) => ({ distance: i < 2 ? 30 : 0, used: i === 0 ? 9 : i }));
    expect(evictions(pics)).toEqual(['k1', 'k0']);
    const gone = kept(PICTURE_CAP + 1, (i) => ({ distance: i === 3 ? Infinity : i === 4 ? 40 : 0 }));
    expect(evictions(gone)).toEqual(['k3']);
  });

  it('a picture arriving is kept only for a book near enough to show it soon', () => {
    expect(worthKeeping(KEEP_DISTANCE)).toBe(true);
    expect(worthKeeping(KEEP_DISTANCE + 1)).toBe(false);
    expect(worthKeeping(Infinity)).toBe(false);
    // The drawn books and the look-ahead all fit under the keep distance and the cap.
    expect(FAN_CAP + LOOK_AHEAD).toBeLessThanOrEqual(KEEP_DISTANCE);
    expect(2 * FAN_CAP + 1 + LOOK_AHEAD + LOOK_BEHIND).toBeLessThanOrEqual(PICTURE_CAP);
  });
});

describe('fades', () => {
  it('a cover arriving on screen fades in; off screen, or with reduced motion, it just shows', () => {
    expect(fadeStart(true, false, 1000)).toBe(1000);
    expect(fadeStart(false, false, 1000)).toBeUndefined();
    expect(fadeStart(true, true, 1000)).toBeUndefined();
  });

  it('runs from 0 to 1 over the duration', () => {
    expect(fadeProgress(1000, 1000, 160, false)).toBe(0);
    expect(fadeProgress(1000, 1080, 160, false)).toBeCloseTo(0.5);
    expect(fadeProgress(1000, 1160, 160, false)).toBe(1);
    expect(fadeProgress(1000, 5000, 160, false)).toBe(1);
    expect(fadeProgress(1000, 900, 160, false)).toBe(0);
  });

  it('is done at once with no fade, reduced motion or no duration', () => {
    expect(fadeProgress(undefined, 1000, 160, false)).toBe(1);
    expect(fadeProgress(1000, 1000, 160, true)).toBe(1);
    expect(fadeProgress(1000, 1000, 0, false)).toBe(1);
    expect(fadeProgress(1000, 1000, Number.NaN, false)).toBe(1);
  });
});
