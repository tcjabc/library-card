/**
 * The Family Staircase as a 3D pile of books (stage 1 prototype, developer tools only).
 * Pure helpers (unit-tested): pretend books, each book's seeded size and wobble, the pile's
 * layout and which books are on screen. One book in the pile = one reader + book, as on the
 * current staircase (one first read per reader per book), so the same title read by two
 * readers appears twice.
 */
import { hashString, visibleWindow as uniformWindow } from '../journeys/staircase';

export interface StackReader {
  id: string;
  avatar: string;
  kind: 'child' | 'grown_up';
  /** The reader's colour (the band on their spines), as a hue in degrees. */
  hue: number;
}

export interface StackEntry {
  /** 1 = the first book read (the bottom of the pile). */
  step: number;
  isbn: string;
  title: string;
  readerId: string;
  avatar: string;
  readerHue: number;
  /** The spine's colour, as a hue in degrees, from a seeded hash of the ISBN. */
  spineHue: number;
}

export interface BookShape {
  /** Spine length (px). */
  width: number;
  /** Front to back (px). */
  depth: number;
  /** How tall the book is lying flat (px). */
  thickness: number;
  /** A small turn about the vertical axis (degrees), so the pile looks hand-stacked. */
  yaw: number;
  /** Sideways and front-back nudges (px). */
  x: number;
  z: number;
}

/** Five pretend readers: three children and two grown-ups, each a clearly different hue. */
export const FAKE_READERS: readonly StackReader[] = [
  { id: 'fake-child-1', avatar: '🦊', kind: 'child', hue: 24 },
  { id: 'fake-child-2', avatar: '🐢', kind: 'child', hue: 145 },
  { id: 'fake-child-3', avatar: '🦄', kind: 'child', hue: 290 },
  { id: 'fake-grown-1', avatar: '🦉', kind: 'grown_up', hue: 210 },
  { id: 'fake-grown-2', avatar: '🐝', kind: 'grown_up', hue: 340 },
];

/** Made-up titles: short, very long, Traditional Chinese and mixed. */
export const FAKE_TITLES: readonly string[] = [
  'Pip',
  'Moon Soup',
  '月亮湯',
  'The Cat Who Counted Clouds',
  'The Extraordinarily Long and Winding Journey of a Very Small Snail Who Wanted to See the Sea Before Breakfast',
  '小熊的雨傘',
  'Ten Tiny Trains',
  '我的阿嬤是神探：夏天的祕密與月光下的長長故事',
  'Rain on the Roof',
  'Dragon Day 龍的生日',
  'Grandpa’s Enormous Book of Questions Nobody Has Ever Asked Before, Volume Two',
  '海邊的小火車',
  'Ox',
];

/** Size presets (px): a book picks one of each, seeded by step. */
export const BOOK_WIDTHS = [176, 194, 212, 230] as const;
export const BOOK_DEPTHS = [104, 118, 132] as const;
export const BOOK_THICKNESSES = [28, 34, 42] as const;
/** The wobble's limits: yaw in degrees, x and z in px. */
export const MAX_YAW = 6;
export const MAX_NUDGE_X = 12;
export const MAX_NUDGE_Z = 10;

/** The fixed camera: tipped down to see the tops, turned a little to see one side. */
export const TILT_X_DEG = -28;
export const TILT_Y_DEG = -24;
/** How much a height along the pile shrinks on screen with the camera tipped. */
export const TILT_SCALE = Math.cos((TILT_X_DEG * Math.PI) / 180);

/** Lite (flat 2D) rows are all this tall (px). */
export const LITE_ROW = 40;

/** Room above the newest book (its top shows above its spine) and below the oldest (px). */
export const STACK_PAD_TOP = 112;
export const STACK_PAD_BOTTOM = 160;

/** 3D: books kept in the page above and below the visible ones. */
export const STACK_BUFFER = 3;

/**
 * Lite: rows kept in the page above and below the visible ones. A whole viewport each way, so a
 * fast flick (which the compositor scrolls ahead of React) doesn't show an empty pile.
 */
export function liteBuffer(viewportHeight: number, rowHeight: number = LITE_ROW): number {
  if (!(rowHeight > 0)) return STACK_BUFFER;
  return Math.max(STACK_BUFFER, Math.ceil(Math.max(0, viewportHeight) / rowHeight));
}

/**
 * hashString (FNV-1a) barely mixes the last character, so keys that differ only at the end
 * (step 11 and 12, ISBN …01 and …02) land close together. This 32-bit finaliser (from
 * MurmurHash3) spreads them, so neighbouring books differ.
 */
export function mixedHash(text: string): number {
  let x = hashString(text);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A number in [0, 1) from the seed, a key and a step: the same on every device. */
function seeded(seed: string, key: string, step: number): number {
  return mixedHash(`${seed}|${key}|${step}`) / 2 ** 32;
}

function pick<T>(list: readonly T[], unit: number): T {
  return list[Math.min(list.length - 1, Math.floor(unit * list.length))];
}

/** A value in [-max, max], to one decimal place. */
function spread(unit: number, max: number): number {
  return Math.round((unit * 2 - 1) * max * 10) / 10;
}

/** A spine colour (hue in degrees) from the ISBN: how real books will get their colour. */
export function spineHue(isbn: string): number {
  return mixedHash(`spine|${isbn}`) % 360;
}

/**
 * `count` pretend reads, step 1 (oldest) first. Mostly new books; now and then a reader reads
 * a book someone else read recently, so it appears again under their name. A reader never
 * has the same book twice. Deterministic: the same count and seed give the same pile, and a
 * longer pile starts with the shorter one.
 */
export function generateFakeStack(count: number, seed: string): StackEntry[] {
  const out: StackEntry[] = [];
  const readBy = new Map<string, Set<string>>(FAKE_READERS.map((r) => [r.id, new Set<string>()]));
  const titleOffset = mixedHash(`${seed}|titles`) % FAKE_TITLES.length;
  let books = 0;
  for (let step = 1; step <= Math.max(0, Math.floor(count)); step++) {
    const reader = FAKE_READERS[mixedHash(`${seed}|reader|${step}`) % FAKE_READERS.length];
    const theirs = readBy.get(reader.id)!;
    let isbn: string | null = null;
    let title = '';
    if (mixedHash(`${seed}|again|${step}`) % 6 === 0) {
      // Someone else's recent book, if there is one this reader hasn't read.
      for (let back = out.length - 1; back >= Math.max(0, out.length - 12); back--) {
        const earlier = out[back];
        if (earlier.readerId !== reader.id && !theirs.has(earlier.isbn)) {
          isbn = earlier.isbn;
          title = earlier.title;
          break;
        }
      }
    }
    if (isbn === null) {
      books += 1;
      isbn = `fake-${String(books).padStart(9, '0')}`;
      title = FAKE_TITLES[(titleOffset + books * 5) % FAKE_TITLES.length];
    }
    theirs.add(isbn);
    out.push({ step, isbn, title, readerId: reader.id, avatar: reader.avatar, readerHue: reader.hue, spineHue: spineHue(isbn) });
  }
  return out;
}

/** A book's size and wobble, seeded by step (and the household, later): stable as the pile grows. */
export function bookShape(seed: string, step: number): BookShape {
  return {
    width: pick(BOOK_WIDTHS, seeded(seed, 'width', step)),
    depth: pick(BOOK_DEPTHS, seeded(seed, 'depth', step)),
    thickness: pick(BOOK_THICKNESSES, seeded(seed, 'thickness', step)),
    yaw: spread(seeded(seed, 'yaw', step), MAX_YAW),
    x: spread(seeded(seed, 'x', step), MAX_NUDGE_X),
    z: spread(seeded(seed, 'z', step), MAX_NUDGE_Z),
  };
}

export interface StackLayout {
  /** tops[i] = how far book i is from the top of the pile (px); i = 0 is the newest book. */
  tops: number[];
  /** The whole pile's height (px). */
  height: number;
}

/** Where each book sits, newest (top of the pile) first. `thicknesses` are oldest first. */
export function stackLayout(thicknesses: readonly number[]): StackLayout {
  const tops: number[] = [];
  let y = 0;
  for (let i = thicknesses.length - 1; i >= 0; i--) {
    tops.push(y);
    y += Math.max(0, thicknesses[i]);
  }
  return { tops, height: y };
}

/** How many of the sorted `tops` are below `y` (strictly, or at or below). */
function countBefore(tops: readonly number[], y: number, inclusive: boolean): number {
  let lo = 0;
  let hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] < y || (inclusive && tops[mid] === y)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Books of different thicknesses: which to render, as [start, end) indexes into `layout.tops`,
 * for the slice of the pile from `from` to `to` px (from its top), plus `buffer` books each way.
 */
export function layoutWindow(layout: StackLayout, from: number, to: number, buffer: number): StackWindow {
  const count = layout.tops.length;
  if (count === 0 || to <= from || to <= 0 || from >= layout.height) {
    const at = from >= layout.height ? count : 0;
    return { start: at, end: at };
  }
  const first = Math.max(0, countBefore(layout.tops, from, true) - 1);
  const last = countBefore(layout.tops, to, false);
  return { start: Math.max(0, first - buffer), end: Math.min(count, last + buffer) };
}

export interface StackWindow {
  start: number;
  end: number;
}

/** Whether two [start, end) windows hold the same books, so the stack can skip a state update. */
export function sameWindow(a: StackWindow, b: StackWindow): boolean {
  return a.start === b.start && a.end === b.end;
}

/** Rows all `itemHeight` tall (the Lite view): which to render, as [start, end). */
export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  total: number,
  buffer: number,
): StackWindow {
  return uniformWindow({ scrollTop, viewportHeight, itemHeight, count: total, buffer: Math.max(0, buffer) });
}
