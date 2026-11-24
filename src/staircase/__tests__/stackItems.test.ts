import { describe, expect, it } from 'vitest';
import { assignReaderColors } from '../../journeys/staircase';
import {
  clampPosition,
  easeStep,
  pileFits,
  positionToScroll,
  scrollHeight,
  scrollToPosition,
  settleTarget,
  startPosition,
  stepCamera,
  stepTarget,
} from '../camera';
import {
  READER_COLOURS,
  atNewest,
  bigYear,
  firstMarkerFrom,
  flagIndexes,
  followPile,
  followUpdate,
  isStackFlag,
  markerTop,
  monthIn,
  monthLabelParts,
  monthStarts,
  readDate,
  stackItems,
  stackKey,
  stackListText,
  stackMarkers,
  type StackItem,
} from '../stackItems';
import { FAKE_DATES_FROM, FAKE_DATES_YEARS, FAKE_READERS, bookShape, fakeFirstReadAt, fakeStackItems, generateFakeStack } from '../stackModel';
import { FAN_CAMERA, ELEVATION_DEG, TWIST_DEG, eyeLineBooks, fannedBook, pileCentres, projectBook, projectPoint, spineLevels } from '../stackProjection';
import { BOOK_DEPTHS, BOOK_THICKNESSES, BOOK_WIDTHS } from '../stackModel';

// The Family Staircase's pile on real reads (src/staircase/stackItems.ts) and where its markers sit.

const read = (reader_id: string, isbn: string, first_read_at: string) => ({ reader_id, isbn, first_read_at });
const readers = [
  { id: 'kid-a', avatar: '🦊' },
  { id: 'kid-b', avatar: '🐢' },
  { id: 'grown-c', avatar: '🦉' },
];
const titles: Record<string, string> = { '111': 'Moon Soup', '222': 'Pip', '333': '   ' };
const placeholder = { title: 'A book', avatar: '📖' };
const items = (reads: ReturnType<typeof read>[]) => stackItems(reads, readers, (isbn) => titles[isbn], placeholder);

/** Stack books with just the dates set, for the month helpers. */
const dated = (...isos: string[]): StackItem[] =>
  isos.map((iso, i) => ({ key: String(i + 1), step: i + 1, isbn: `x${i}`, title: 't', readerId: 'r', avatar: 'a', readerColour: 1, firstReadAt: iso }));

describe('stackItems', () => {
  it('orders like the old staircase: first read, then reader id, then ISBN, numbering steps from 1', () => {
    const stack = items([
      read('kid-b', '222', '2026-03-02T09:00:00.000Z'),
      read('kid-a', '222', '2026-03-02T09:00:00.000Z'), // same time: reader id breaks the tie
      read('kid-a', '111', '2026-03-02T09:00:00.000Z'), // same reader too: ISBN breaks it
      read('grown-c', '111', '2026-03-01T18:00:00.000Z'), // grown-ups' reads count
    ]);
    expect(stack.map((s) => [s.step, s.readerId, s.isbn])).toEqual([
      [1, 'grown-c', '111'],
      [2, 'kid-a', '111'],
      [3, 'kid-a', '222'],
      [4, 'kid-b', '222'],
    ]);
  });

  it('keeps one book per reader + book: the same title read by two readers is on the pile twice', () => {
    const stack = items([read('kid-a', '111', '2026-01-01T00:00:00.000Z'), read('kid-b', '111', '2026-01-05T00:00:00.000Z')]);
    expect(stack.map((s) => s.key)).toEqual([stackKey('kid-a', '111'), stackKey('kid-b', '111')]);
    expect(stack.map((s) => s.title)).toEqual(['Moon Soup', 'Moon Soup']);
    expect(new Set(stack.map((s) => s.key)).size).toBe(2);
  });

  it('gives each book its reader’s avatar and colour (as the old staircase), with friendly placeholders', () => {
    const stack = items([
      read('kid-a', '111', '2026-01-01T00:00:00.000Z'),
      read('kid-b', '333', '2026-01-02T00:00:00.000Z'), // a blank title
      read('gone', '444', '2026-01-03T00:00:00.000Z'), // a reader who is gone, a book with no row
    ]);
    const colours = assignReaderColors(readers.map((r) => r.id), READER_COLOURS);
    expect(stack[0]).toMatchObject({ avatar: '🦊', title: 'Moon Soup', readerColour: colours.get('kid-a')! + 1, firstReadAt: '2026-01-01T00:00:00.000Z' });
    expect(stack[1]).toMatchObject({ avatar: '🐢', title: 'A book', readerColour: colours.get('kid-b')! + 1 });
    expect(stack[2]).toMatchObject({ avatar: '📖', title: 'A book' });
    for (const s of stack) expect(s.readerColour).toBeGreaterThanOrEqual(1);
    for (const s of stack) expect(s.readerColour).toBeLessThanOrEqual(READER_COLOURS);
  });

  it('is empty without reads', () => {
    expect(items([])).toEqual([]);
  });
});

describe('book-number flags', () => {
  it('flags the first book, 10, 50, 100 and then every 100', () => {
    const flagged = Array.from({ length: 1000 }, (_, i) => i + 1).filter(isStackFlag);
    expect(flagged).toEqual([1, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(isStackFlag(25)).toBe(false); // the old staircase's milestone, not a flag here
    expect(isStackFlag(150)).toBe(false);
    expect(isStackFlag(0)).toBe(false);
    expect(isStackFlag(1.5)).toBe(false);
  });

  it('finds the flagged books by index and writes their text', () => {
    const stack = dated(...Array.from({ length: 120 }, () => '2026-05-01T10:00:00.000Z'));
    expect(flagIndexes(stack)).toEqual([0, 9, 49, 99]);
    const { flags } = stackMarkers(stack, 'UTC', { locale: 'en', first: 'First book!', number: '#{count}' });
    expect(flags).toEqual([
      { index: 0, text: 'First book!' },
      { index: 9, text: '#10' },
      { index: 49, text: '#50' },
      { index: 99, text: '#100' },
    ]);
  });
});

describe('month date lines', () => {
  it('reads a book’s month in the household’s time zone, near midnight at a month’s end', () => {
    // 16:30 UTC on 31 October is 00:30 on 1 November in Taipei.
    expect(monthIn('2026-10-31T16:30:00.000Z', 'Asia/Taipei')).toEqual({ year: 2026, month: 11 });
    expect(monthIn('2026-10-31T16:30:00.000Z', 'UTC')).toEqual({ year: 2026, month: 10 });
    // 03:00 UTC on 1 March is still 28 February in New York.
    expect(monthIn('2026-03-01T03:00:00.000Z', 'America/New_York')).toEqual({ year: 2026, month: 2 });
    expect(monthIn('not a date', 'UTC')).toBeNull();
  });

  it('starts a month at the oldest book and wherever the month changes, with no line for empty months', () => {
    const stack = dated(
      '2026-01-03T10:00:00.000Z',
      '2026-01-20T10:00:00.000Z',
      '2026-04-02T10:00:00.000Z', // February and March had no books
      '2026-04-30T10:00:00.000Z',
      '2026-05-01T10:00:00.000Z',
    );
    expect(monthStarts(stack, 'UTC')).toEqual([
      { index: 0, year: 2026, month: 1 },
      { index: 2, year: 2026, month: 4 },
      { index: 4, year: 2026, month: 5 },
    ]);
    expect(monthStarts([], 'UTC')).toEqual([]);
  });

  it('puts the line between the last book of December and the first of January', () => {
    const stack = dated('2026-12-31T22:00:00.000Z', '2027-01-01T08:00:00.000Z');
    expect(monthStarts(stack, 'UTC').map((m) => [m.index, m.year, m.month])).toEqual([
      [0, 2026, 12],
      [1, 2027, 1],
    ]);
    // In Taipei (UTC+8) 22:00 UTC on 31 December is already 1 January: one month, no line between.
    expect(monthStarts(stack, 'Asia/Taipei').map((m) => [m.index, m.year, m.month])).toEqual([[0, 2027, 1]]);
  });

  it('follows daylight saving time', () => {
    // London is on BST (UTC+1) from 29 March 2026: 23:30 UTC on 31 March is 00:30 on 1 April.
    const spring = dated('2026-03-31T22:30:00.000Z', '2026-03-31T23:30:00.000Z');
    expect(monthStarts(spring, 'Europe/London').map((m) => [m.index, m.month])).toEqual([
      [0, 3],
      [1, 4],
    ]);
    // Back on GMT from 25 October: 23:30 UTC on 31 October is still 31 October.
    const autumn = dated('2026-10-31T23:30:00.000Z', '2026-11-01T00:30:00.000Z');
    expect(monthStarts(autumn, 'Europe/London').map((m) => [m.index, m.month])).toEqual([
      [0, 10],
      [1, 11],
    ]);
  });

  it('keeps a book whose time can’t be read in the month under it', () => {
    const stack = dated('2026-06-10T10:00:00.000Z', 'bad', '2026-07-01T10:00:00.000Z');
    expect(monthStarts(stack, 'UTC').map((m) => m.index)).toEqual([0, 2]);
  });

  it('labels each month in the app’s language, the year larger in January and on the oldest month', () => {
    const parts = monthLabelParts(2026, 11, 'en');
    expect(parts.map((p) => p.text).join('')).toBe('Nov 2026');
    expect(parts.filter((p) => p.year).map((p) => p.text)).toEqual(['2026']);
    expect(bigYear({ index: 5, year: 2027, month: 1 }, false)).toBe(true);
    expect(bigYear({ index: 0, year: 2026, month: 6 }, true)).toBe(true);
    expect(bigYear({ index: 5, year: 2026, month: 7 }, false)).toBe(false);
    const { months } = stackMarkers(dated('2026-06-10T10:00:00.000Z', '2026-07-01T10:00:00.000Z', '2027-01-05T10:00:00.000Z'), 'UTC', {
      locale: 'en',
      first: 'First book!',
      number: '#{count}',
    });
    expect(months.map((m) => [m.index, m.parts.map((p) => p.text).join(''), m.big])).toEqual([
      [0, 'Jun 2026', true],
      [1, 'Jul 2026', false],
      [2, 'Jan 2027', true],
    ]);
  });
});

describe('firstMarkerFrom', () => {
  it('finds where the draw window’s markers start', () => {
    const markers = [{ index: 0 }, { index: 9 }, { index: 49 }, { index: 99 }];
    expect(firstMarkerFrom(markers, 0)).toBe(0);
    expect(firstMarkerFrom(markers, 1)).toBe(1);
    expect(firstMarkerFrom(markers, 49)).toBe(2);
    expect(firstMarkerFrom(markers, 100)).toBe(4);
    expect(firstMarkerFrom([], 3)).toBe(0);
  });
});

describe('where markers sit', () => {
  const shapes = generateFakeStack(30, 'markers').map((e) => bookShape('markers', e.step));
  const centres = pileCentres(shapes.map((s) => s.thickness));
  const frontOf = (index: number, s: number, originY: number) => {
    const book = projectBook(fannedBook(index, index + 1, shapes[index], centres, s, TWIST_DEG), { camera: FAN_CAMERA, originX: 200, originY });
    return book.faces.find((f) => f.side === 'front')!;
  };

  it('level with a book’s spine: its middle and its bottom edge, for the book in front and turned ones', () => {
    for (const [index, s] of [
      [12, 12],
      [14, 12],
      [9, 12.4],
    ]) {
      const front = frontOf(index, s, 300);
      const level = spineLevels(index, shapes[index], centres, s, TWIST_DEG, 300);
      expect(level.middle).toBeCloseTo(front.origin.y + front.u.y / 2 + front.v.y / 2, 6);
      expect(level.bottom).toBeCloseTo(front.origin.y + front.u.y / 2 + front.v.y, 6);
    }
  });

  it('a month line under a book is on the seam with the book below it', () => {
    // Book 12 square-on: the line under it is the top edge of book 11's spine.
    const below = frontOf(11, 12, 300);
    const level = spineLevels(12, shapes[12], centres, 12, TWIST_DEG, 300);
    expect(level.bottom).toBeGreaterThan(below.origin.y - 2 * Math.abs(below.u.y) - 10);
    expect(level.bottom).toBeLessThan(below.origin.y + below.v.y);
  });

});

describe('the resting rule', () => {
  const biggest = { thickness: Math.max(...BOOK_THICKNESSES), width: Math.max(...BOOK_WIDTHS), depth: Math.max(...BOOK_DEPTHS) };
  const GAP = 24;
  // A phone's stack area (412 × 915 less the header and the bar).
  const H = 760;
  const K = eyeLineBooks(H, biggest, GAP);

  it('works out K, the books that fit above the eye line, from the view height and the book pitch', () => {
    const pitch = Math.cos((ELEVATION_DEG * Math.PI) / 180) * biggest.thickness;
    expect(K).toBeGreaterThan(3);
    expect(K).toBeLessThan(H / 2 / pitch);
    // Taller views fit more books, never fewer; a tiny view fits none.
    let previous = 0;
    for (let h = 0; h <= 2000; h += 20) {
      const k = eyeLineBooks(h, biggest, GAP);
      expect(k).toBeGreaterThanOrEqual(previous);
      previous = k;
    }
    expect(eyeLineBooks(100, biggest, GAP)).toBe(0);
    expect(eyeLineBooks(H, { ...biggest, thickness: 0 }, GAP)).toBe(0);
  });

  it('a pile of K + 1 of the biggest books, turned any way, stays in view above the eye line', () => {
    const shapes = Array.from({ length: K + 1 }, () => ({ ...biggest, yaw: 0, x: 0, z: 0 }));
    const centres = pileCentres(shapes.map((sh) => sh.thickness));
    for (const twist of [0, TWIST_DEG, 15]) {
      const top = projectBook(fannedBook(K, K + 1, shapes[K], centres, 0, twist), { camera: FAN_CAMERA, originX: 200, originY: H / 2 });
      for (const f of top.faces) for (const y of [f.origin.y, f.origin.y + f.u.y, f.origin.y + f.v.y, f.origin.y + f.u.y + f.v.y]) expect(y).toBeGreaterThanOrEqual(GAP - 0.001);
    }
    // With the camera on the base book (position 0), its middle is at the camera's origin: the eye line.
    const base = fannedBook(0, 1, shapes[0], centres, 0, TWIST_DEG);
    const middle = projectPoint({ x: 0, y: base.top + shapes[0].thickness / 2, z: 0 }, { camera: FAN_CAMERA, originX: 200, originY: H / 2 });
    expect(middle.y).toBeCloseTo(H / 2, 6);
  });

  it('fits a pile of N books when N - 1 <= K: N = 0, 1, 2, 7, K + 1 fit; K + 2, 40 and 1,000 don’t', () => {
    for (const n of [0, 1, 2, Math.min(7, K + 1), K + 1]) expect(pileFits(n, K)).toBe(true);
    for (const n of [K + 2, 40, 1000]) expect(pileFits(n, K)).toBe(false);
    expect(pileFits(1, 0)).toBe(true);
    expect(pileFits(2, 0)).toBe(false);
  });

  it('the camera’s range is always the whole pile, [0, N - 1], short or tall', () => {
    for (const n of [2, 7, K + 1, K + 2, 40]) {
      const bottom = scrollHeight(n, H) - H;
      expect(bottom).toBe(positionToScroll(0, n));
      expect(bottom).toBeGreaterThan(0);
      expect(scrollToPosition(0, n)).toBe(n - 1); // the top of the scroll: the newest book
      expect(scrollToPosition(bottom, n)).toBe(0); // the bottom: the base book
      expect(clampPosition(scrollToPosition(bottom + 500, n), n)).toBe(0);
    }
  });

  it('has nothing to scroll for no books or one', () => {
    for (const n of [0, 1]) {
      expect(scrollHeight(n, H)).toBe(H);
      expect(scrollToPosition(300, n)).toBe(0);
      expect(stepTarget(0, 1, n)).toBe(0);
    }
  });

  it('starts a pile that fits on its base book and a taller one on the newest', () => {
    for (const n of [1, 2, 7, K + 1]) expect(startPosition(n, K)).toBe(0);
    for (const n of [K + 2, 40, 1000]) expect(startPosition(n, K)).toBe(n - 1);
    expect(startPosition(0, K)).toBe(0);
    // The base book at the start is the bottom of the scroll range: scrolling up goes to the newer books.
    expect(positionToScroll(startPosition(7, K), 7)).toBe(6 * 56);
  });

  it('scrolls a short pile from its base book up to the newest and back down, easing and settling on whole books', () => {
    const n = Math.min(7, K + 1);
    const bottom = positionToScroll(0, n);
    // Halfway up: the eased camera heads there over a few frames, then settles on a whole book.
    const target = scrollToPosition(bottom / 2, n);
    expect(target).toBeCloseTo((n - 1) / 2, 6);
    let shown = 0;
    for (let frame = 0; frame < 200; frame++) {
      const next = stepCamera(shown, target, 1000 / 60, false);
      expect(next.shown).toBeGreaterThanOrEqual(shown);
      shown = next.shown;
      if (next.done) break;
    }
    expect(shown).toBe(target);
    expect(Number.isInteger(settleTarget(target, n))).toBe(true);
    expect(easeStep(0, n - 1, 16)).toBeGreaterThan(0);
    expect(scrollToPosition(0, n)).toBe(n - 1); // all the way up: the newest
    expect(scrollToPosition(bottom, n)).toBe(0); // and back down: the base
    // Arrow keys walk the same range.
    let s = 0;
    for (let i = 0; i < n + 3; i++) s = stepTarget(s, 1, n);
    expect(s).toBe(n - 1);
    for (let i = 0; i < n + 3; i++) s = stepTarget(s, -1, n);
    expect(s).toBe(0);
  });

  it('turning the screen changes K (where a pile would start), not the reader’s book or its scroll offset', () => {
    const tall = eyeLineBooks(1200, biggest, GAP);
    const short = eyeLineBooks(500, biggest, GAP);
    expect(tall).toBeGreaterThan(short);
    const n = short + 2;
    expect(startPosition(n, tall)).toBe(0);
    expect(startPosition(n, short)).toBe(n - 1);
    // A book's scroll offset doesn't depend on the view's height, so a turn keeps it in front of the reader.
    for (const position of [0, 3, n - 1]) {
      const top = positionToScroll(position, n);
      expect(scrollToPosition(top, n)).toBe(position);
      expect(top).toBeLessThanOrEqual(scrollHeight(n, 500) - 500);
      expect(top).toBeLessThanOrEqual(scrollHeight(n, 1200) - 1200);
    }
  });
});

describe('live updates on the pile', () => {
  const K = eyeLineBooks(760, { thickness: Math.max(...BOOK_THICKNESSES), width: Math.max(...BOOK_WIDTHS), depth: Math.max(...BOOK_DEPTHS) }, 24);
  const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);

  it('stays on the base book as the pile grows', () => {
    expect(followPile(keys(3), keys(4), 0, 0)).toEqual({ target: 0, shown: 0 });
    expect(followPile(keys(1), keys(2), 0, 0)).toEqual({ target: 0, shown: 0 });
  });

  it('follows the newest book up when the reader was at the newest', () => {
    expect(followPile(keys(20), keys(21), 19, 19)).toEqual({ target: 20, shown: 19 });
    expect(followPile(keys(5), keys(6), 4, 4)).toEqual({ target: 5, shown: 4 });
  });

  it('keeps the reader’s book in the middle of the pile', () => {
    expect(followPile(keys(20), keys(21), 7, 7)).toEqual({ target: 7, shown: 7 });
    // A read confirmed later, below the reader's book: the book moves up a place and so do they.
    expect(followPile(['a', 'b', 'c', 'd'], ['a', 'x', 'b', 'c', 'd'], 2, 2)).toEqual({ target: 3, shown: 3 });
  });

  it('crossing K changes nothing for the camera: no jump', () => {
    const n = K + 1;
    expect(pileFits(n, K)).toBe(true);
    expect(pileFits(n + 1, K)).toBe(false);
    expect(followPile(keys(n), keys(n + 1), 0, 0)).toEqual({ target: 0, shown: 0 }); // on the base
    expect(followPile(keys(n), keys(n + 1), 2, 2)).toEqual({ target: 2, shown: 2 }); // in the middle
  });

  it('copes with books going, down to none', () => {
    expect(followPile(keys(5), keys(3), 4, 4)).toEqual({ target: 2, shown: 2 });
    expect(followPile(keys(1), [], 0, 0)).toEqual({ target: 0, shown: 0 });
  });
});

describe('markerTop', () => {
  const middle = { left: 90, right: 320, top: 400, bottom: 500 };
  const label = (x: number, y: number) => ({ x, y, width: 100, height: 30 });

  it('leaves a label that doesn’t cover the book in the middle where it is', () => {
    expect(markerTop(label(12, 300), middle, 800, 4)).toBe(300); // above it
    expect(markerTop(label(12, 600), middle, 800, 4)).toBe(600); // below it
    expect(markerTop(label(330, 450), middle, 800, 4)).toBe(450); // beside it
  });

  it('moves a label that would cover it just above or below, whichever is nearer', () => {
    expect(markerTop(label(12, 405), middle, 800, 4)).toBe(400 - 4 - 30);
    expect(markerTop(label(12, 470), middle, 800, 4)).toBe(500 + 4);
  });

  it('uses the side that fits in the view', () => {
    expect(markerTop(label(12, 470), middle, 520, 4)).toBe(400 - 4 - 30); // no room below
    expect(markerTop(label(12, 20), { ...middle, top: 10 }, 800, 4)).toBe(500 + 4); // no room above
  });

  it('never leaves a label off the view, even when neither side has room', () => {
    expect(markerTop(label(12, 450), { ...middle, top: 10, bottom: 790 }, 800, 4)).toBe(0);
    expect(markerTop(label(12, 450), { ...middle, top: 10, bottom: 790 }, 800, 4)).toBeGreaterThanOrEqual(0);
  });
});

describe('live updates', () => {
  const keys = (...k: string[]) => k;

  it('follows a new book to the top when the reader was at the newest', () => {
    const moved = followUpdate(keys('a', 'b', 'c'), keys('a', 'b', 'c', 'd'), 2, 2);
    expect(moved).toEqual({ target: 3, shown: 2 }); // eases up from c to d
    expect(atNewest(2, 3)).toBe(true);
    expect(atNewest(1.4, 3)).toBe(false);
  });

  it('keeps the reader’s book in front of them when they’re elsewhere in the pile', () => {
    // A new newest book: nothing moves.
    expect(followUpdate(keys('a', 'b', 'c'), keys('a', 'b', 'c', 'd'), 1, 1)).toEqual({ target: 1, shown: 1 });
    // A read confirmed later lands below the reader's book: their book moves up one place, and so do they.
    expect(followUpdate(keys('a', 'b', 'c', 'd'), keys('a', 'x', 'b', 'c', 'd'), 2, 2.25)).toEqual({ target: 3, shown: 3.25 });
  });

  it('when the reader’s book has gone, the nearest older one that’s still there takes its place', () => {
    expect(followUpdate(keys('a', 'b', 'c', 'd'), keys('a', 'b', 'd'), 2, 2)).toEqual({ target: 1, shown: 1 });
    expect(followUpdate(keys('a', 'b'), keys('c'), 0, 0)).toEqual({ target: 0, shown: 0 });
    // The newest book undone while looking at it: the new newest.
    expect(followUpdate(keys('a', 'b', 'c'), keys('a', 'b'), 2, 2)).toEqual({ target: 1, shown: 1 });
  });

  it('starts at the newest book, and copes with an empty pile', () => {
    expect(followUpdate([], keys('a', 'b'), 0, 0)).toEqual({ target: 1, shown: 1 });
    expect(followUpdate(keys('a'), [], 0, 0)).toEqual({ target: 0, shown: 0 });
  });
});

describe('arrow keys', () => {
  it('step one whole book up (newer) or down (older), staying on the pile', () => {
    expect(stepTarget(5, 1, 10)).toBe(6);
    expect(stepTarget(5.3, -1, 10)).toBe(4);
    expect(stepTarget(9, 1, 10)).toBe(9);
    expect(stepTarget(0, -1, 10)).toBe(0);
  });
});

describe('the screen reader list', () => {
  it('reads "Step N, title, read by reader, date" with the date in the household’s time zone', () => {
    const [item] = stackItems([read('kid-a', '111', '2026-10-31T16:30:00.000Z')], readers, (isbn) => titles[isbn], placeholder);
    const text = { locale: 'en', template: 'Step {step}, {title}, read by {reader}, {date}' };
    expect(stackListText(item, 'Pip', 'Asia/Taipei', text)).toBe('Step 1, Moon Soup, read by Pip, November 1, 2026');
    expect(stackListText(item, 'Pip', 'UTC', text)).toBe('Step 1, Moon Soup, read by Pip, October 31, 2026');
    expect(readDate('nope', 'UTC', 'en')).toBe('');
  });
});

describe('the pretend piles', () => {
  it('spread their dates over several years, in step order', () => {
    const at = Array.from({ length: 1000 }, (_, i) => fakeFirstReadAt(i + 1, 1000, 'dev'));
    for (let i = 1; i < at.length; i++) expect(at[i] > at[i - 1]).toBe(true);
    expect(Date.parse(at[0])).toBeGreaterThanOrEqual(FAKE_DATES_FROM);
    expect(Date.parse(at[999]) - FAKE_DATES_FROM).toBeGreaterThan((FAKE_DATES_YEARS - 0.1) * 365 * 86_400_000);
    expect(monthStarts(at.map((firstReadAt) => ({ firstReadAt })), 'UTC').length).toBe(FAKE_DATES_YEARS * 12);
  });

  it('become stack books keyed by step, so their shapes match the pretend 3D pile', () => {
    const entries = generateFakeStack(50, 'dev');
    const stack = fakeStackItems(entries, 'dev');
    expect(stack.map((s) => s.key)).toEqual(entries.map((e) => String(e.step)));
    for (const s of stack) expect(bookShape('dev', s.key)).toEqual(bookShape('dev', s.step));
    const colour = new Map(FAKE_READERS.map((r, i) => [r.id, i + 1]));
    for (const s of stack) expect(s.readerColour).toBe(colour.get(s.readerId));
  });
});

describe('covers on the pile’s books', () => {
  it('carries each book’s cover when asked, and nothing extra when not', () => {
    const reads = [read('kid-a', '111', '2026-10-01T10:00:00.000Z'), read('kid-b', '222', '2026-10-02T10:00:00.000Z')];
    const covers: Record<string, string> = { '111': 'https://covers.openlibrary.org/b/isbn/111-M.jpg' };
    const withCovers = stackItems(reads, readers, (isbn) => titles[isbn], placeholder, (isbn) => covers[isbn]);
    expect(withCovers.map((i) => i.cover)).toEqual([covers['111'], null]);
    expect(stackItems(reads, readers, (isbn) => titles[isbn], placeholder).every((i) => !('cover' in i))).toBe(true);
  });
});
