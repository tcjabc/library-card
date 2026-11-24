import { describe, expect, it } from 'vitest';
import {
  AREA,
  ASPECT_RANGE,
  BIGGEST_SHAPED_BOOK,
  REF_ASPECT,
  STANDARD_DEPTH,
  STANDARD_WIDTH,
  STRENGTH,
  THICKEST,
  THICKNESS,
  THICKNESS_BUCKET,
  THINNEST,
  VARIETY,
  WIDTH_BUCKET,
  WIDTH_RANGE,
  bookThickness,
  coverAspect,
  coverFootprint,
  easeFootprint,
  pileShape,
  shapedBook,
  sizeBucket,
  spineTextScale,
  thicknessHash,
  usableAspect,
} from '../bookShapes';
import { COLOURS_KEY, SHAPES_KEY, parseColours, parseShapes, rememberShape, serialiseShapes } from '../coverColour';
import { isAppStorageKey } from '../../grownups/helpers';
import { dropActive, startDrop, stepDrop } from '../dropMotion';
import { GAP_BOOK_HEIGHT } from '../stackModel';
import { STACK_SHAPES_KEY } from '../shapeSetting';
import { bookLift, liftAbove, lineLift } from '../eyeGap';
import { BIGGEST_BOOK, bookShape } from '../stackModel';
import { FAN_CAMERA, TWIST_DEG, eyeLineBooks, eyeLineReach, fannedBook, heightAt, pileCentres, projectBook, spineLevels } from '../stackProjection';
import { fadeProgress } from '../coverPlan';

// Books shaped like their covers (src/staircase/bookShapes.ts).

const near = (a: { width: number; depth: number }, w: number, d: number, digits = 0) => {
  expect(a.width).toBeCloseTo(w, digits);
  expect(a.depth).toBeCloseTo(d, digits);
};

describe('the constants', () => {
  it('are the mock-up’s defaults', () => {
    expect(STANDARD_WIDTH).toBe(190);
    expect(STANDARD_DEPTH).toBe(124);
    expect(AREA).toBe(190 * 124);
    expect(ASPECT_RANGE).toEqual([0.45, 1.6]);
    expect(WIDTH_RANGE).toEqual([120, 240]);
    expect(STRENGTH).toBe(1);
    expect(VARIETY).toBe(0.3);
    expect(THICKNESS).toBe(28);
    expect(THICKEST).toBeCloseTo(28 * 1.135, 10);
    expect(THINNEST).toBeCloseTo(28 * 0.865, 10);
    // The gap still counts in 28-unit books.
    expect(GAP_BOOK_HEIGHT).toBe(28);
  });
});

describe('the footprint from the cover’s shape', () => {
  it('keeps the area and follows the shape: tall, standard, square, wide', () => {
    near(coverFootprint(0.45), Math.sqrt(AREA / 0.45), 0.45 * Math.sqrt(AREA / 0.45), 6);
    near(coverFootprint(0.55), 207, 114);
    near(coverFootprint(REF_ASPECT), 190, 124, 6);
    near(coverFootprint(0.65), 190, 124);
    near(coverFootprint(0.75), 177, 133);
    near(coverFootprint(1.0), 153, 153);
    near(coverFootprint(1.25), 137, 172);
    near(coverFootprint(1.3), 135, 175);
    near(coverFootprint(1.6), 121, 194);
    for (const a of [0.45, 0.55, 0.65, 0.75, 1, 1.25, 1.6]) {
      const f = coverFootprint(a);
      expect(f.width * f.depth).toBeCloseTo(AREA, 6);
      expect(f.depth / f.width).toBeCloseTo(a, 6);
    }
  });

  it('an unknown or unusable cover is the standard book; out-of-range shapes are clamped', () => {
    near(coverFootprint(null), 190, 124, 6);
    near(coverFootprint(undefined), 190, 124, 6);
    near(coverFootprint(Number.NaN), 190, 124, 6);
    near(coverFootprint(0), 190, 124, 6);
    expect(coverFootprint(0.1)).toEqual(coverFootprint(0.45));
    expect(coverFootprint(9)).toEqual(coverFootprint(1.6));
    expect(usableAspect(null)).toBe(REF_ASPECT);
  });

  it('strength 0: every book standard; strength 1: the cover’s own shape', () => {
    for (const a of [0.45, 1, 1.6]) near(coverFootprint(a, 0), 190, 124, 6);
    expect(coverFootprint(1, 1).depth / coverFootprint(1, 1).width).toBeCloseTo(1, 6);
  });

  it('keeps the spine length within 120–240', () => {
    for (let a = 0.45; a <= 1.6; a += 0.01) {
      const f = coverFootprint(a);
      expect(f.width).toBeGreaterThanOrEqual(120);
      expect(f.width).toBeLessThanOrEqual(240);
    }
  });
});

describe('a cover’s shape from its size', () => {
  it('width ÷ height, clamped; zero, negative, NaN or infinite sizes are rejected', () => {
    expect(coverAspect(120, 180)).toBeCloseTo(2 / 3, 10);
    expect(coverAspect(300, 100)).toBe(1.6);
    expect(coverAspect(10, 100)).toBe(0.45);
    expect(coverAspect(0, 180)).toBeNull();
    expect(coverAspect(120, 0)).toBeNull();
    expect(coverAspect(-1, 10)).toBeNull();
    expect(coverAspect(Number.NaN, 10)).toBeNull();
    expect(coverAspect(Infinity, 10)).toBeNull();
  });
});

describe('thickness', () => {
  const keys = Array.from({ length: 2000 }, (_, i) => (i % 7 === 0 ? `noisbn:${i}` : `978${String(100000000 + i)}`));

  it('is the same for a book everywhere, from its key only (never its cover)', () => {
    for (const k of keys.slice(0, 50)) expect(bookThickness(k)).toBe(bookThickness(k));
    expect(thicknessHash('9781234567897')).toBe(thicknessHash('9781234567897'));
    expect(shapedBook('9781234567897')).toEqual(shapedBook('9781234567897'));
  });

  it('stays within 0.865–1.135 × 28 and uses most of that range', () => {
    const t = keys.map((k) => bookThickness(k));
    expect(Math.min(...t)).toBeGreaterThanOrEqual(THINNEST);
    expect(Math.max(...t)).toBeLessThanOrEqual(THICKEST);
    expect(Math.max(...t) - Math.min(...t)).toBeGreaterThan(0.9 * (THICKEST - THINNEST));
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    expect(mean).toBeCloseTo(28, 0);
  });

  it('variety 0: every book 28', () => {
    expect(bookThickness('anything', 0)).toBe(28);
  });
});

describe('size buckets and the ease', () => {
  it('rounds sizes to a few buckets, so the label and page-edge caches stay small', () => {
    expect(sizeBucket(190, WIDTH_BUCKET)).toBe(192);
    expect(sizeBucket(206.97, WIDTH_BUCKET)).toBe(204);
    expect(sizeBucket(27.3, THICKNESS_BUCKET)).toBe(27.5);
    const widths = new Set<number>();
    for (let a = 0.45; a <= 1.6; a += 0.001) widths.add(sizeBucket(coverFootprint(a).width, WIDTH_BUCKET));
    expect(widths.size).toBeLessThanOrEqual(20);
    const thick = new Set(Array.from({ length: 2000 }, (_, i) => sizeBucket(bookThickness(`k${i}`), THICKNESS_BUCKET)));
    expect(thick.size).toBeLessThanOrEqual(17);
  });

  it('eases a footprint from the standard one to the cover’s', () => {
    const from = { width: 190, depth: 124 };
    const to = coverFootprint(1);
    expect(easeFootprint(from, to, 0)).toEqual(from);
    expect(easeFootprint(from, to, 1)).toEqual(to);
    const half = easeFootprint(from, to, 0.5);
    expect(half.width).toBeCloseTo((190 + to.width) / 2, 10);
    expect(easeFootprint(from, to, 2)).toEqual(to);
    // Over the crossfade (160 ms), instantly with reduced motion.
    expect(fadeProgress(1000, 1080, 160, false)).toBeCloseTo(0.5, 10);
    expect(fadeProgress(1000, 1000, 160, true)).toBe(1);
  });

  it('scales the spine’s text with the book’s thickness', () => {
    expect(spineTextScale(28)).toBe(1);
    expect(spineTextScale(THICKEST)).toBeCloseTo(1.135, 10);
    expect(spineTextScale(THINNEST)).toBeCloseTo(0.865, 10);
  });
});

describe('the shape cache', () => {
  it('is its own key beside the colours, under the app’s prefix (cleared by "Reset this device")', () => {
    expect(SHAPES_KEY).toBe('library-card:cover-shapes');
    expect(SHAPES_KEY).not.toBe(COLOURS_KEY);
    expect(isAppStorageKey(SHAPES_KEY)).toBe(true);
    expect(isAppStorageKey(STACK_SHAPES_KEY)).toBe(true);
  });

  it('reads and writes shapes; the colour cache’s old entries are untouched', () => {
    const m = parseShapes(null);
    rememberShape(m, 'https://covers.openlibrary.org/b/isbn/1-M.jpg', 0.5512345);
    rememberShape(m, 'photo:abc', 1.3);
    const back = parseShapes(serialiseShapes(m));
    expect(back.get('photo:abc')).toBe(1.3);
    expect(back.get('https://covers.openlibrary.org/b/isbn/1-M.jpg')).toBe(0.5512);
    // Junk, a wrong version and bad entries are skipped.
    expect(parseShapes('not json').size).toBe(0);
    expect(parseShapes(JSON.stringify({ v: 2, shapes: [['a', 1]] })).size).toBe(0);
    expect(parseShapes(JSON.stringify({ v: 1, shapes: [['a', 0], ['b', 'x'], ['c', -1], ['d', 0.8]] })).size).toBe(1);
    // A colour cache written by 1.12.0 still reads as before.
    const old = JSON.stringify({ v: 1, colours: [['photo:abc', '#aa3322'], ['x', '']] });
    expect(parseColours(old).get('photo:abc')).toBe('#aa3322');
    expect(parseColours(old).get('x')).toBe('');
  });

  it('keeps at most 2,000, the oldest going first', () => {
    const m = parseShapes(null);
    for (let i = 0; i < 2005; i++) rememberShape(m, `k${i}`, 1);
    expect(m.size).toBe(2000);
    expect(m.has('k0')).toBe(false);
    expect(m.has('k2004')).toBe(true);
  });
});

describe('the pile with shaped books', () => {
  const isbns = Array.from({ length: 30 }, (_, i) => `97800000${String(i).padStart(5, '0')}`);
  const aspects = [0.55, 1, 1.3, null, 0.7, 1.6, 0.45];
  const shapes = isbns.map((isbn, i) => ({ ...shapedBook(isbn), ...coverFootprint(aspects[i % aspects.length]) }));
  const centres = pileCentres(shapes.map((s) => s.thickness));
  const view = { camera: FAN_CAMERA, originX: 200, originY: 300 };

  it('switched off, every book has the seeded size it had in 1.12.0', () => {
    for (const [i, isbn] of isbns.entries()) {
      const item = { key: `kid-1|${isbn}`, isbn };
      expect(pileShape(false, 'household', item)).toEqual(bookShape('household', item.key));
      expect(pileShape(true, 'household', item)).toEqual(shapedBook(isbn));
      expect(i).toBeGreaterThanOrEqual(0);
    }
  });

  it('books of different thicknesses sit on each other exactly: no gaps, no overlaps', () => {
    for (let i = 1; i < shapes.length; i++) {
      const below = fannedBook(i - 1, i, shapes[i - 1], centres, 12, TWIST_DEG);
      const above = fannedBook(i, i + 1, shapes[i], centres, 12, TWIST_DEG);
      expect(above.top + shapes[i].thickness).toBeCloseTo(below.top, 10);
    }
  });

  it('the camera’s height between two books is interpolated between their centres', () => {
    expect(heightAt(centres, 4)).toBe(centres[4]);
    expect(heightAt(centres, 4.25)).toBeCloseTo(centres[4] + 0.25 * (centres[5] - centres[4]), 10);
    // The eye-line book's middle is at the camera's origin whatever its thickness.
    for (const s of [3, 7, 11]) {
      const book = fannedBook(s, s + 1, shapes[s], centres, s, TWIST_DEG);
      expect(book.top + shapes[s].thickness / 2).toBeCloseTo(0, 10);
    }
  });

  it('a cover’s footprint changes nothing above or below it: thickness doesn’t depend on the cover', () => {
    const wide = shapes.map((s, i) => (i === 5 ? { ...s, ...coverFootprint(1.6) } : s));
    expect(pileCentres(wide.map((s) => s.thickness))).toEqual(centres);
  });

  it('flags stay level with their spine, month lines between two books, with the gap on mixed books', () => {
    for (const [index, s] of [
      [12, 12],
      [13, 12],
      [11, 12.4],
      [20, 18.6],
    ]) {
      const lift = bookLift(index, s);
      const front = projectBook(fannedBook(index, index + 1, shapes[index], centres, s, TWIST_DEG, lift), view).faces.find((f) => f.side === 'front')!;
      const level = spineLevels(index, shapes[index], centres, s, TWIST_DEG, 300, lift);
      expect(level.middle).toBeCloseTo(front.origin.y + front.u.y / 2 + front.v.y / 2, 6);
    }
    // The line under book 13 with the camera on 12: half way between book 13's lift and book 12's.
    expect(lineLift(13, 12)).toBeCloseTo((bookLift(13, 12) + bookLift(12, 12)) / 2, 10);
  });

  it('a drop lands every book on the one under it, whatever their thicknesses', () => {
    const world = startDrop(20, 26);
    for (let t = 0; t < 10000 && dropActive(world); t += 16) stepDrop(world, 16, (i) => shapes[i].thickness);
    expect(world.fallers.every((f) => f.state === 'resting' && f.h === 0)).toBe(true);
    // At rest each book is back in its place in the pile (heights from the books' own thicknesses).
    for (let i = 21; i < 26; i++) {
      const below = fannedBook(i - 1, i, shapes[i - 1], centres, 25, TWIST_DEG);
      const above = fannedBook(i, i + 1, shapes[i], centres, 25, TWIST_DEG);
      expect(above.top + shapes[i].thickness).toBeCloseTo(below.top, 10);
    }
  });
});

describe('K and the eye line’s reach with shaped books', () => {
  it('use the thickest shaped book, with the footprint whose diagonal is longest', () => {
    expect(BIGGEST_SHAPED_BOOK.thickness).toBeCloseTo(THICKEST, 10);
    let longest = 0;
    for (let a = 0.45; a <= 1.6; a += 0.005) {
      const f = coverFootprint(a);
      longest = Math.max(longest, Math.hypot(f.width, f.depth));
    }
    expect(Math.hypot(BIGGEST_SHAPED_BOOK.width, BIGGEST_SHAPED_BOOK.depth)).toBeGreaterThanOrEqual(longest - 1e-9);
  });

  it('fit more books above the eye line than the old seeded sizes (thinner books), gap included', () => {
    const H = 773;
    const gap = 24;
    const old = eyeLineBooks(H, BIGGEST_BOOK, gap, liftAbove(true));
    const shaped = eyeLineBooks(H, BIGGEST_SHAPED_BOOK, gap, liftAbove(true));
    expect(old).toBe(5);
    expect(shaped).toBeGreaterThan(old);
    expect(eyeLineReach(BIGGEST_SHAPED_BOOK, 12)).toBeLessThan(eyeLineReach(BIGGEST_BOOK, 12));
  });

  it('a pile of K + 1 of the biggest shaped books, lifted and turned any way, still fits above the eye line', () => {
    const H = 773;
    const gap = 24;
    const k = eyeLineBooks(H, BIGGEST_SHAPED_BOOK, gap, liftAbove(true));
    const pile = Array.from({ length: k + 1 }, () => ({ ...BIGGEST_SHAPED_BOOK, yaw: 0, x: 0, z: 0 }));
    const c = pileCentres(pile.map((p) => p.thickness));
    for (const twist of [0, TWIST_DEG, 15]) {
      const top = projectBook(fannedBook(k, k + 1, pile[k], c, 0, twist, bookLift(k, 0)), { camera: FAN_CAMERA, originX: 200, originY: H / 2 });
      for (const f of top.faces) for (const y of [f.origin.y, f.origin.y + f.u.y, f.origin.y + f.v.y, f.origin.y + f.u.y + f.v.y]) expect(y).toBeGreaterThanOrEqual(gap - 0.001);
    }
  });
});
