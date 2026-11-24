import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppStorageKey } from '../../grownups/helpers';
import { pileFits, startPosition } from '../camera';
import { GAP_DOWN_PX, GAP_UP_PX, bookLift, eyeGapLift, liftAbove, lineLift, smoothstep } from '../eyeGap';
import { STACK_GAP_KEY, readStackGap, writeStackGap } from '../gapSetting';
import { BIGGEST_BOOK, GAP_BOOK_HEIGHT, GAP_DOWN, GAP_RAMP, GAP_UP, bookShape, generateFakeStack } from '../stackModel';
import {
  ELEVATION_DEG,
  FAN_CAMERA,
  TWIST_DEG,
  eyeLineBooks,
  eyeLineReach,
  fannedBook,
  pileCentres,
  projectBook,
  spineLevels,
} from '../stackProjection';

// The gap around the eye-line book (src/staircase/eyeGap.ts).

const RISE = Math.cos((ELEVATION_DEG * Math.PI) / 180);

describe('smoothstep', () => {
  it('is 0 up to a, 1 from b, an S-curve between', () => {
    expect(smoothstep(0, 0.3, 1)).toBe(0);
    expect(smoothstep(0.3, 0.3, 1)).toBe(0);
    expect(smoothstep(0.65, 0.3, 1)).toBeCloseTo(0.5, 10);
    expect(smoothstep(1, 0.3, 1)).toBe(1);
    expect(smoothstep(5, 0.3, 1)).toBe(1);
    expect(smoothstep(-5, 0.3, 1)).toBe(0);
    // u = 0.25: u²(3 - 2u) = 0.15625.
    expect(smoothstep(0.475, 0.3, 1)).toBeCloseTo(0.15625, 10);
  });

  it('copes with an empty ramp', () => {
    expect(smoothstep(0.5, 1, 1)).toBe(0);
    expect(smoothstep(1, 1, 1)).toBe(1);
  });
});

describe('the constants', () => {
  it('are the mock-up’s proportions, in book heights: up 2.5 (70 for a 28 book), down 1.3 (36), ramp 0.3–1.0', () => {
    expect(GAP_BOOK_HEIGHT).toBe(28);
    expect(GAP_UP).toBe(2.5);
    expect(GAP_DOWN).toBe(1.3);
    expect(GAP_RAMP).toEqual([0.3, 1.0]);
    expect(GAP_UP_PX).toBe(70);
    expect(GAP_DOWN_PX).toBeCloseTo(36.4, 10);
  });
});

describe('eyeGapLift', () => {
  it('lifts the books above fully, lowers the ones below fully, leaves the eye-line book', () => {
    expect(eyeGapLift(2)).toBe(GAP_UP_PX);
    expect(eyeGapLift(1)).toBe(GAP_UP_PX);
    expect(eyeGapLift(0.65)).toBeCloseTo(GAP_UP_PX / 2, 10);
    expect(eyeGapLift(0.3)).toBe(0);
    expect(eyeGapLift(0)).toBe(0);
    expect(eyeGapLift(-0.3)).toBe(0);
    expect(eyeGapLift(-0.65)).toBeCloseTo(-GAP_DOWN_PX / 2, 10);
    expect(eyeGapLift(-1)).toBe(-GAP_DOWN_PX);
    expect(eyeGapLift(-5)).toBe(-GAP_DOWN_PX);
  });

  it('has the same shape up and down, scaled by each side’s size', () => {
    for (const t of [0, 0.1, 0.3, 0.4, 0.5, 0.65, 0.8, 0.99, 1, 3]) {
      expect(eyeGapLift(t) / GAP_UP_PX).toBeCloseTo(-eyeGapLift(-t) / GAP_DOWN_PX, 10);
    }
  });

  it('is continuous and only ever rises with t (so the gap slides smoothly as the camera moves)', () => {
    let previous = eyeGapLift(-3);
    for (let t = -3; t <= 3; t += 0.001) {
      const lift = eyeGapLift(t);
      expect(lift).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(Math.abs(lift - previous)).toBeLessThan(0.2);
      previous = lift;
    }
  });

  it('is nothing at all with the gap off (the 1.10.2 pile)', () => {
    for (const t of [-3, -1, -0.5, 0, 0.5, 1, 3]) expect(eyeGapLift(t, false)).toBe(0);
    expect(bookLift(5, 2, false)).toBe(0);
    expect(lineLift(5, 4.5, false)).toBe(0);
    expect(liftAbove(false)).toBe(0);
    expect(eyeGapLift(Number.NaN)).toBe(0);
  });

  it('follows the camera: a book’s lift depends on index − s', () => {
    expect(bookLift(10, 10)).toBe(0);
    expect(bookLift(11, 10)).toBe(GAP_UP_PX);
    expect(bookLift(9, 10)).toBe(-GAP_DOWN_PX);
    // Half a book between 10 and 11: both are half way out of the eye line, the gap between them.
    expect(bookLift(11, 10.5)).toBeCloseTo(eyeGapLift(0.5), 10);
    expect(bookLift(10, 10.5)).toBeCloseTo(eyeGapLift(-0.5), 10);
  });
});

describe('markers move with their books', () => {
  const shapes = generateFakeStack(30, 'gap').map((e) => bookShape('gap', e.step));
  const centres = pileCentres(shapes.map((s) => s.thickness));
  const frontOf = (index: number, s: number, lift: number) => {
    const book = projectBook(fannedBook(index, index + 1, shapes[index], centres, s, TWIST_DEG, lift), { camera: FAN_CAMERA, originX: 200, originY: 300 });
    return book.faces.find((f) => f.side === 'front')!;
  };

  it('a flag takes its own book’s lift: still level with the middle of its spine', () => {
    for (const [index, s] of [
      [12, 12],
      [13, 12],
      [11, 12],
      [12, 12.4],
    ]) {
      const lift = bookLift(index, s);
      const front = frontOf(index, s, lift);
      const level = spineLevels(index, shapes[index], centres, s, TWIST_DEG, 300, lift);
      expect(level.middle).toBeCloseTo(front.origin.y + front.u.y / 2 + front.v.y / 2, 6);
    }
  });

  it('a lift moves a book and its spine up the screen by lift × cos(elevation)', () => {
    const flat = spineLevels(14, shapes[14], centres, 12, TWIST_DEG, 300);
    const lifted = spineLevels(14, shapes[14], centres, 12, TWIST_DEG, 300, GAP_UP_PX);
    expect(flat.middle - lifted.middle).toBeCloseTo(GAP_UP_PX * RISE, 6);
    const a = fannedBook(14, 15, shapes[14], centres, 12, TWIST_DEG);
    const b = fannedBook(14, 15, shapes[14], centres, 12, TWIST_DEG, GAP_UP_PX);
    expect(a.top - b.top).toBeCloseTo(GAP_UP_PX, 10);
  });

  it('a month line between two books takes the average of their lifts: the middle of the gap', () => {
    // The camera on book 11: book 12 (the month's first) is lifted, book 11 isn't.
    expect(lineLift(12, 11)).toBeCloseTo(GAP_UP_PX / 2, 10);
    // The camera on book 12: book 12 stays, book 11 drops.
    expect(lineLift(12, 12)).toBeCloseTo(-GAP_DOWN_PX / 2, 10);
    // Far above or below the camera, both books moved the same: no gap there, the line on the seam.
    expect(lineLift(20, 11)).toBe(GAP_UP_PX);
    expect(lineLift(5, 11)).toBe(-GAP_DOWN_PX);
    // Two books at different t, part way.
    expect(lineLift(12, 11.4)).toBeCloseTo((eyeGapLift(0.6) + eyeGapLift(-0.4)) / 2, 10);
    // The base book has nothing under it: its own lift.
    expect(lineLift(0, 3)).toBe(bookLift(0, 3));
  });

  it('the line sits between the lifted book’s spine and the one below it', () => {
    const s = 11;
    const upper = frontOf(12, s, bookLift(12, s));
    const lower = frontOf(11, s, bookLift(11, s));
    const line = spineLevels(12, shapes[12], centres, s, TWIST_DEG, 300, lineLift(12, s)).bottom;
    const upperBottom = upper.origin.y + upper.u.y / 2 + upper.v.y;
    const lowerTop = lower.origin.y + lower.u.y / 2;
    expect(line).toBeGreaterThan(upperBottom);
    expect(line).toBeLessThan(lowerTop);
  });
});

describe('the resting rule with the gap', () => {
  const GAP = 24;
  const H = 760;
  const off = eyeLineBooks(H, BIGGEST_BOOK, GAP, liftAbove(false));
  const on = eyeLineBooks(H, BIGGEST_BOOK, GAP, liftAbove(true));

  it('K leaves room for the lifted books: fewer books fit with the gap on', () => {
    expect(off).toBe(eyeLineBooks(H, BIGGEST_BOOK, GAP));
    expect(on).toBeLessThan(off);
    const pitch = RISE * BIGGEST_BOOK.thickness;
    // The lift costs GAP_UP_PX × cos(elevation) of the view: about 1.7 of the biggest books.
    expect(off - on).toBeGreaterThanOrEqual(Math.floor((GAP_UP_PX * RISE) / pitch));
    expect(off - on).toBeLessThanOrEqual(Math.ceil((GAP_UP_PX * RISE) / pitch));
    for (let h = 0; h <= 2000; h += 20) expect(eyeLineBooks(h, BIGGEST_BOOK, GAP, liftAbove(true))).toBeLessThanOrEqual(eyeLineBooks(h, BIGGEST_BOOK, GAP));
    expect(eyeLineBooks(200, BIGGEST_BOOK, GAP, liftAbove(true))).toBe(0);
  });

  it('a pile of K + 1 of the biggest books, lifted and turned any way, still fits above the eye line', () => {
    const shapes = Array.from({ length: on + 1 }, () => ({ ...BIGGEST_BOOK, yaw: 0, x: 0, z: 0 }));
    const centres = pileCentres(shapes.map((sh) => sh.thickness));
    for (const twist of [0, TWIST_DEG, 15]) {
      const top = projectBook(fannedBook(on, on + 1, shapes[on], centres, 0, twist, bookLift(on, 0)), {
        camera: FAN_CAMERA,
        originX: 200,
        originY: H / 2,
      });
      for (const f of top.faces) for (const y of [f.origin.y, f.origin.y + f.u.y, f.origin.y + f.v.y, f.origin.y + f.u.y + f.v.y]) expect(y).toBeGreaterThanOrEqual(GAP - 0.001);
    }
  });

  it('thresholds: N - 1 <= K opens on the base book, one more opens on the newest', () => {
    expect(pileFits(on + 1, on)).toBe(true);
    expect(startPosition(on + 1, on)).toBe(0);
    expect(pileFits(on + 2, on)).toBe(false);
    expect(startPosition(on + 2, on)).toBe(on + 1);
    // A pile that fitted without the gap but not with it now opens on its newest book.
    for (let n = on + 2; n <= off + 1; n++) {
      expect(startPosition(n, off)).toBe(0);
      expect(startPosition(n, on)).toBe(n - 1);
    }
  });

  it('the eye-line book doesn’t move, so its reach (where the half sheet stops) is the same', () => {
    expect(bookLift(4, 4)).toBe(0);
    expect(eyeLineReach(BIGGEST_BOOK, 12)).toBe(eyeLineReach(BIGGEST_BOOK, 12));
    // The books below only drop away from it: the first one is further below with the gap.
    expect(bookLift(3, 4)).toBeLessThan(0);
  });
});

describe('the "Gap around the eye-line book" switch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is on by default, stored per device as "off", and cleared with the app’s other keys', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    expect(readStackGap()).toBe(true);
    writeStackGap(false);
    expect(data.get(STACK_GAP_KEY)).toBe('off');
    expect(readStackGap()).toBe(false);
    writeStackGap(true);
    expect(data.has(STACK_GAP_KEY)).toBe(false);
    expect(readStackGap()).toBe(true);
    expect(isAppStorageKey(STACK_GAP_KEY)).toBe(true);
  });

  it('is on when storage can’t be read', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readStackGap()).toBe(true);
  });
});
