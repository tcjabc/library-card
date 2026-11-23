import { describe, expect, it } from 'vitest';
import {
  BOOK_DEPTHS,
  BOOK_THICKNESSES,
  BOOK_WIDTHS,
  FAKE_READERS,
  MAX_NUDGE_X,
  MAX_NUDGE_Z,
  MAX_YAW,
  bookShape,
  generateFakeStack,
  layoutWindow,
  spineHue,
  stackLayout,
  visibleWindow,
} from '../stackModel';

// The 3D book pile prototype (src/staircase/stackModel.ts).

const CJK = /[㐀-鿿]/;

describe('generateFakeStack', () => {
  it('makes exactly `count` entries, steps 1..count, oldest first', () => {
    const stack = generateFakeStack(250, 'seed');
    expect(stack).toHaveLength(250);
    expect(stack.map((e) => e.step)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(generateFakeStack(0, 'seed')).toEqual([]);
    expect(generateFakeStack(-3, 'seed')).toEqual([]);
  });

  it('is deterministic, and a longer pile starts with the shorter one', () => {
    expect(generateFakeStack(300, 'household-a')).toEqual(generateFakeStack(300, 'household-a'));
    expect(generateFakeStack(1000, 'household-a').slice(0, 300)).toEqual(generateFakeStack(300, 'household-a'));
    expect(generateFakeStack(300, 'household-b')).not.toEqual(generateFakeStack(300, 'household-a'));
  });

  it('mixes short, very long and Chinese titles', () => {
    const titles = generateFakeStack(100, 'seed').map((e) => e.title);
    expect(titles.some((t) => t.length <= 4)).toBe(true);
    expect(titles.some((t) => t.length >= 60)).toBe(true);
    expect(titles.some((t) => CJK.test(t))).toBe(true);
  });

  it('uses all five readers (3 children, 2 grown-ups), each with its own hue', () => {
    expect(FAKE_READERS.filter((r) => r.kind === 'child')).toHaveLength(3);
    expect(FAKE_READERS.filter((r) => r.kind === 'grown_up')).toHaveLength(2);
    expect(new Set(FAKE_READERS.map((r) => r.hue)).size).toBe(FAKE_READERS.length);
    const stack = generateFakeStack(500, 'seed');
    expect(new Set(stack.map((e) => e.readerId))).toEqual(new Set(FAKE_READERS.map((r) => r.id)));
    for (const e of stack) {
      const reader = FAKE_READERS.find((r) => r.id === e.readerId)!;
      expect([e.avatar, e.readerHue]).toEqual([reader.avatar, reader.hue]);
    }
  });

  it('repeats a book under a different reader, but never twice for one reader', () => {
    const stack = generateFakeStack(1000, 'seed');
    const pairs = new Set(stack.map((e) => `${e.readerId}|${e.isbn}`));
    expect(pairs.size).toBe(stack.length);
    const byIsbn = new Map<string, Set<string>>();
    for (const e of stack) byIsbn.set(e.isbn, (byIsbn.get(e.isbn) ?? new Set()).add(e.readerId));
    expect([...byIsbn.values()].some((readers) => readers.size >= 2)).toBe(true);
    // The same ISBN always has the same title and spine colour.
    for (const e of stack) expect(e.spineHue).toBe(spineHue(e.isbn));
  });
});

describe('spineHue', () => {
  it('is a hue in [0, 360), the same for the same ISBN', () => {
    for (const isbn of ['fake-000000001', '9780000000002', '']) {
      const hue = spineHue(isbn);
      expect(Number.isInteger(hue) && hue >= 0 && hue < 360).toBe(true);
      expect(spineHue(isbn)).toBe(hue);
    }
    expect(spineHue('fake-000000001')).not.toBe(spineHue('fake-000000002'));
  });

  it('spreads neighbouring ISBNs round the colour wheel', () => {
    const hues = Array.from({ length: 720 }, (_, i) => spineHue(`fake-${String(i + 1).padStart(9, '0')}`));
    const buckets = new Array(12).fill(0);
    for (const hue of hues) buckets[Math.floor(hue / 30)] += 1;
    // Each 30° slice gets a fair share (60 on average).
    expect(Math.min(...buckets)).toBeGreaterThan(40);
    // Next-door ISBNs aren't stuck in one half of the wheel.
    const near = hues.slice(1).filter((hue, i) => Math.min(Math.abs(hue - hues[i]), 360 - Math.abs(hue - hues[i])) < 30).length;
    expect(near).toBeLessThan(hues.length * 0.3);
  });
});

describe('bookShape', () => {
  it('stays within the presets and limits', () => {
    for (let step = 1; step <= 2000; step++) {
      const s = bookShape('seed', step);
      expect(BOOK_WIDTHS).toContain(s.width);
      expect(BOOK_DEPTHS).toContain(s.depth);
      expect(BOOK_THICKNESSES).toContain(s.thickness);
      expect(Math.abs(s.yaw)).toBeLessThanOrEqual(MAX_YAW);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(MAX_NUDGE_X);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(MAX_NUDGE_Z);
    }
  });

  it('is deterministic per seed and step, and varies between steps', () => {
    expect(bookShape('seed', 42)).toEqual(bookShape('seed', 42));
    expect(bookShape('other', 42)).not.toEqual(bookShape('seed', 42));
    const shapes = Array.from({ length: 200 }, (_, i) => bookShape('seed', i + 1));
    expect(new Set(shapes.map((s) => s.thickness)).size).toBe(BOOK_THICKNESSES.length);
    expect(new Set(shapes.map((s) => s.width)).size).toBe(BOOK_WIDTHS.length);
    expect(shapes.some((s) => s.yaw < -3) && shapes.some((s) => s.yaw > 3)).toBe(true);
  });
});

describe('stackLayout', () => {
  it('puts the newest book on top and stacks the rest under it', () => {
    // Oldest first: 10, 20, 30 thick. Newest (30) is at the top.
    expect(stackLayout([10, 20, 30])).toEqual({ tops: [0, 30, 50], height: 60 });
    expect(stackLayout([])).toEqual({ tops: [], height: 0 });
  });
});

describe('layoutWindow', () => {
  const layout = stackLayout([10, 20, 30]); // tops [0, 30, 50], height 60

  it('picks the books that overlap the slice', () => {
    expect(layoutWindow(layout, 0, 10, 0)).toEqual({ start: 0, end: 1 });
    expect(layoutWindow(layout, 35, 55, 0)).toEqual({ start: 1, end: 3 });
    expect(layoutWindow(layout, 30, 31, 0)).toEqual({ start: 1, end: 2 });
  });

  it('adds the buffer, clamped to the pile', () => {
    expect(layoutWindow(layout, 35, 40, 1)).toEqual({ start: 0, end: 3 });
    expect(layoutWindow(layout, 0, 1000, 5)).toEqual({ start: 0, end: 3 });
  });

  it('is empty above, below or for an empty pile', () => {
    expect(layoutWindow(layout, -100, -1, 0)).toEqual({ start: 0, end: 0 });
    expect(layoutWindow(layout, 60, 100, 0)).toEqual({ start: 3, end: 3 });
    expect(layoutWindow(stackLayout([]), 0, 100, 2)).toEqual({ start: 0, end: 0 });
  });

  it('finds a slice deep in a big pile', () => {
    const big = stackLayout(Array.from({ length: 3000 }, (_, i) => BOOK_THICKNESSES[i % 3]));
    const mid = big.height / 2;
    const { start, end } = layoutWindow(big, mid, mid + 800, 2);
    expect(end - start).toBeLessThan(40);
    expect(big.tops[start + 2]).toBeLessThanOrEqual(mid);
    expect(big.tops[end - 3]).toBeLessThan(mid + 800);
  });
});

describe('visibleWindow', () => {
  it('at the top: the first screenful plus the buffer below', () => {
    expect(visibleWindow(0, 400, 40, 1000, 3)).toEqual({ start: 0, end: 13 });
  });

  it('at the bottom: clamped to the total', () => {
    expect(visibleWindow(40 * 990, 400, 40, 1000, 3)).toEqual({ start: 987, end: 1000 });
    expect(visibleWindow(1e9, 400, 40, 1000, 3)).toEqual({ start: 1000, end: 1000 });
  });

  it('tiny totals: everything, or nothing', () => {
    expect(visibleWindow(0, 400, 40, 1, 3)).toEqual({ start: 0, end: 1 });
    expect(visibleWindow(0, 400, 40, 0, 3)).toEqual({ start: 0, end: 0 });
  });

  it('huge totals: only a window', () => {
    const { start, end } = visibleWindow(40 * 1_000_000, 800, 40, 5_000_000, 4);
    expect([start, end]).toEqual([999_996, 1_000_024]);
  });

  it('negative scroll and odd inputs are safe', () => {
    expect(visibleWindow(-500, 400, 40, 1000, 0)).toEqual({ start: 0, end: 10 });
    expect(visibleWindow(0, 400, 0, 1000, 3)).toEqual({ start: 0, end: 0 });
    expect(visibleWindow(0, 400, 40, 1000, -2)).toEqual({ start: 0, end: 10 });
  });
});
