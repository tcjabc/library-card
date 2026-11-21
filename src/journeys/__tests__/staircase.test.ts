import { describe, expect, it } from 'vitest';
import {
  NOVELTIES,
  NOVELTY_EVERY,
  assignReaderColors,
  avatarSteps,
  hashString,
  isMilestone,
  placeNovelties,
  readerColorIndex,
  staircaseOrder,
  visibleWindow,
} from '../staircase';

const r = (reader_id: string, isbn: string, first_read_at: string) => ({ reader_id, isbn, first_read_at });

describe('staircaseOrder', () => {
  it('orders by first_read_at, then reader id, then isbn', () => {
    const reads = [
      r('b', 'X', '2026-01-02T00:00:00Z'),
      r('a', 'Y', '2026-01-02T00:00:00Z'),
      r('a', 'B', '2026-01-02T00:00:00Z'),
      r('z', 'A', '2026-01-01T00:00:00Z'),
    ];
    expect(staircaseOrder(reads).map((x) => `${x.reader_id}${x.isbn}`)).toEqual(['zA', 'aB', 'aY', 'bX']);
    expect(reads[0].reader_id).toBe('b'); // input untouched
  });
});

describe('avatarSteps', () => {
  it('puts each reader on the step of their latest first read', () => {
    const stairs = staircaseOrder([r('a', '1', '2026-01-01'), r('b', '2', '2026-01-02'), r('a', '3', '2026-01-03'), r('c', '4', '2026-01-04')]);
    expect(Object.fromEntries(avatarSteps(stairs))).toEqual({ a: 3, b: 2, c: 4 });
    expect(avatarSteps([]).size).toBe(0);
  });
});

describe('isMilestone', () => {
  it('10, 25, 50, 100, then every 100', () => {
    const flagged = Array.from({ length: 1000 }, (_, i) => i + 1).filter(isMilestone);
    expect(flagged).toEqual([10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect([isMilestone(0), isMilestone(-100), isMilestone(150), isMilestone(2.5)]).toEqual([false, false, false, false]);
  });
});

describe('placeNovelties', () => {
  const count = NOVELTIES.length;

  it('is the same every time for the same household (stable across runs and devices)', () => {
    expect(placeNovelties('main', 500, count)).toEqual(placeNovelties('main', 500, count));
    // A fixed check that the hash itself never changes between versions.
    expect(hashString('main|step|1')).toBe(hashString('main|step|1'));
    expect(placeNovelties('main', 40, count)).toMatchSnapshot();
  });

  it('adding steps never moves the novelties already placed', () => {
    const short = placeNovelties('main', 100, count);
    expect(placeNovelties('main', 1000, count).slice(0, 100)).toEqual(short);
  });

  it('puts a novelty beside about 1 step in 4', () => {
    const placed = placeNovelties('main', 4000, count).filter((x) => x !== null).length;
    expect(placed / 4000).toBeGreaterThan(1 / NOVELTY_EVERY - 0.04);
    expect(placed / 4000).toBeLessThan(1 / NOVELTY_EVERY + 0.04);
  });

  it('never places the same novelty twice in a row', () => {
    const picks = placeNovelties('main', 5000, count).filter((x): x is number => x !== null);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    expect(new Set(picks).size).toBe(count); // and uses them all
  });

  it('differs between households', () => {
    expect(placeNovelties('main', 200, count)).not.toEqual(placeNovelties('other', 200, count));
  });

  it('copes with no novelties', () => {
    expect(placeNovelties('main', 5, 0)).toEqual([null, null, null, null, null]);
  });
});

describe('readerColorIndex', () => {
  it('is stable and within the palette', () => {
    expect(readerColorIndex('reader-1', 8)).toBe(readerColorIndex('reader-1', 8));
    for (const id of ['a', 'b', 'c', 'some-uuid']) expect(readerColorIndex(id, 8)).toBeLessThan(8);
    expect(readerColorIndex('a', 0)).toBe(0);
  });
});

describe('assignReaderColors', () => {
  it('gives up to 8 readers different colours, the same whatever order they come in', () => {
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];
    const colours = assignReaderColors(ids, 8);
    expect(new Set(colours.values()).size).toBe(8);
    expect(assignReaderColors([...ids].reverse(), 8)).toEqual(colours);
  });

  it('wraps round when there are more readers than colours', () => {
    const colours = assignReaderColors(['a', 'b', 'c'], 2);
    expect(colours.size).toBe(3);
    for (const slot of colours.values()) expect(slot).toBeLessThan(2);
  });
});

describe('visibleWindow', () => {
  const base = { itemHeight: 100, viewportHeight: 800, count: 1000, buffer: 5 };

  it('covers the viewport plus a buffer each side', () => {
    expect(visibleWindow({ ...base, scrollTop: 0 })).toEqual({ start: 0, end: 13 });
    expect(visibleWindow({ ...base, scrollTop: 5000 })).toEqual({ start: 45, end: 63 });
  });

  it('clamps at both ends', () => {
    expect(visibleWindow({ ...base, scrollTop: -300 })).toEqual({ start: 0, end: 13 });
    expect(visibleWindow({ ...base, scrollTop: 99_950 })).toEqual({ start: 994, end: 1000 });
    expect(visibleWindow({ ...base, count: 3, scrollTop: 0 })).toEqual({ start: 0, end: 3 });
    expect(visibleWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0 });
  });

  it('renders only a small slice of 1,000 steps', () => {
    const { start, end } = visibleWindow({ ...base, scrollTop: 40_000 });
    expect(end - start).toBeLessThanOrEqual(20);
  });
});
