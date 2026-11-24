/**
 * The Family Staircase's book stack on the household's real reads (pure, unit-tested): the
 * stack books in order, their step numbers, the month date lines and the book-number flags, the
 * rule for live updates, and the screen reader list's text.
 *
 * One stack book = one reader + book: that reader's first CONFIRMED read of it (a read summary;
 * pending reads never make one). Steps are numbered in the same order as the old staircase
 * (staircaseOrder: first_read_at, then reader id, then ISBN), so step N is the household's Nth
 * first read, grown-ups' reads included.
 */
import { fmt } from '../strings';
import { assignReaderColors, readerColorIndex, staircaseOrder, type StairRead } from '../journeys/staircase';

/** Reader colours: theme.css --reader-1 … --reader-8, as on the old staircase. */
export const READER_COLOURS = 8;

export interface StackItem {
  /** Reader id + ISBN: the same stack book on every load and device. */
  key: string;
  /** 1 = the household's first confirmed first read (the bottom of the pile). */
  step: number;
  isbn: string;
  title: string;
  readerId: string;
  avatar: string;
  /** The reader's colour slot, 1 to READER_COLOURS (--reader-N), for the band on the spine. */
  readerColour: number;
  /** The reader's first confirmed read of the book (ISO, UTC). */
  firstReadAt: string;
}

export interface StackReaderInfo {
  id: string;
  avatar: string;
}

/** A stack book's key: one per reader + book. */
export function stackKey(readerId: string, isbn: string): string {
  return `${readerId}|${isbn}`;
}

/**
 * The stack books, oldest first (step 1 first), from the household's read summaries. A missing
 * or blank title becomes `placeholder.title`; a reader who is gone gets `placeholder.avatar` and
 * a colour from their id. Colours are assigned as on the old staircase (assignReaderColors).
 */
export function stackItems(
  summaries: readonly StairRead[],
  readers: readonly StackReaderInfo[],
  titleOf: (isbn: string) => string | null | undefined,
  placeholder: { title: string; avatar: string },
): StackItem[] {
  const byId = new Map(readers.map((r) => [r.id, r]));
  const colours = assignReaderColors(
    readers.map((r) => r.id),
    READER_COLOURS,
  );
  return staircaseOrder(summaries).map((read, i) => {
    const reader = byId.get(read.reader_id);
    const title = titleOf(read.isbn)?.trim();
    return {
      key: stackKey(read.reader_id, read.isbn),
      step: i + 1,
      isbn: read.isbn,
      title: title || placeholder.title,
      readerId: read.reader_id,
      avatar: reader?.avatar || placeholder.avatar,
      readerColour: (colours.get(read.reader_id) ?? readerColorIndex(read.reader_id, READER_COLOURS)) + 1,
      firstReadAt: read.first_read_at,
    };
  });
}

// ---- Book-number flags ----

/** Steps with a flag: the first book, 10, 50, 100 and then every 100. (The old staircase's own milestones are separate.) */
export function isStackFlag(step: number): boolean {
  if (!Number.isInteger(step) || step < 1) return false;
  return step === 1 || step === 10 || step === 50 || step % 100 === 0;
}

/** The indexes (oldest first) of the stack books with a flag. */
export function flagIndexes(items: readonly { step: number }[]): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (isStackFlag(item.step)) out.push(i);
  });
  return out;
}

// ---- Month date lines ----

const monthFormats = new Map<string, Intl.DateTimeFormat>();

function monthFormat(zone: string): Intl.DateTimeFormat {
  let format = monthFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric' });
    monthFormats.set(zone, format);
  }
  return format;
}

/** The calendar month of an instant in a time zone, or null for a timestamp that can't be read. */
export function monthIn(iso: string, zone: string): { year: number; month: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = monthFormat(zone).formatToParts(ms);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return Number.isInteger(year) && Number.isInteger(month) ? { year, month } : null;
}

export interface MonthStart {
  /** The first stack book (index, oldest first) of the month: its line runs under this book. */
  index: number;
  year: number;
  /** 1 = January. */
  month: number;
}

/**
 * Where each calendar month starts in the pile, in the household's time zone: the oldest book
 * (index 0) starts the oldest month, then a new month starts wherever a book's month differs from
 * the one under it. Months without books have no start. A book whose time can't be read stays
 * in the month under it.
 */
export function monthStarts(items: readonly { firstReadAt: string }[], zone: string): MonthStart[] {
  const out: MonthStart[] = [];
  let current: { year: number; month: number } | null = null;
  items.forEach((item, index) => {
    const at = monthIn(item.firstReadAt, zone);
    if (!at) return;
    if (!current || at.year !== current.year || at.month !== current.month) {
      out.push({ index, ...at });
      current = at;
    }
  });
  return out;
}

/** A month's label shows its year larger in January and on the oldest month. */
export function bigYear(start: MonthStart, oldest: boolean): boolean {
  return start.month === 1 || oldest;
}

// ---- Markers for the canvas ----

/** A piece of a month label: the month name, the year, or the text between them. */
export interface LabelPart {
  text: string;
  year: boolean;
}

export interface MonthMarker {
  index: number;
  parts: LabelPart[];
  /** The year drawn larger (January, and the oldest month). */
  big: boolean;
}

export interface FlagMarker {
  index: number;
  text: string;
}

/** What the canvas draws besides the books, each list sorted by index (oldest first). */
export interface StackMarkers {
  months: MonthMarker[];
  flags: FlagMarker[];
}

const labelFormats = new Map<string, Intl.DateTimeFormat>();

/** "Nov 2026" as parts, in the app's language. The month is already worked out in the household's zone. */
export function monthLabelParts(year: number, month: number, locale: string): LabelPart[] {
  let format = labelFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short' });
    labelFormats.set(locale, format);
  }
  return format
    .formatToParts(Date.UTC(year, month - 1, 15))
    .filter((p) => p.type === 'month' || p.type === 'year' || p.type === 'literal')
    .map((p) => ({ text: p.value, year: p.type === 'year' }));
}

export interface MarkerText {
  locale: string;
  /** The first book's flag. */
  first: string;
  /** Other flags: "#{count}". */
  number: string;
}

/** The month lines and flags for a pile, in the household's time zone. */
export function stackMarkers(items: readonly StackItem[], zone: string, text: MarkerText): StackMarkers {
  const months = monthStarts(items, zone).map((start, i) => ({
    index: start.index,
    parts: monthLabelParts(start.year, start.month, text.locale),
    big: bigYear(start, i === 0),
  }));
  const flags = flagIndexes(items).map((index) => {
    const step = items[index].step;
    return { index, text: step === 1 ? text.first : fmt(text.number, { count: step.toLocaleString(text.locale) }) };
  });
  return { months, flags };
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a marker's label goes (its top, px): where it was put (`label.y`), unless it would cover
 * the book in the middle of the view (`middle`, that book's box on screen). Then it moves just
 * above or below that book, whichever side its own middle is nearer, or the side that fits in
 * the view (`viewHeight`) when only one does. `gap` is the space left between them.
 */
export function markerTop(
  label: { x: number; y: number; width: number; height: number },
  middle: Box,
  viewHeight: number,
  gap: number,
): number {
  const covers = label.x < middle.right && label.x + label.width > middle.left && label.y < middle.bottom && label.y + label.height > middle.top;
  if (!covers) return label.y;
  const above = middle.top - gap - label.height;
  const below = middle.bottom + gap;
  const fitsAbove = above >= 0;
  const fitsBelow = below + label.height <= viewHeight;
  const nearerAbove = label.y + label.height / 2 <= (middle.top + middle.bottom) / 2;
  const inView = (top: number) => Math.min(Math.max(0, viewHeight - label.height), Math.max(0, top));
  if (fitsAbove && fitsBelow) return nearerAbove ? above : below;
  if (fitsBelow) return below;
  // Neither side has room: as near above it as the view allows, never off the view.
  return inView(above);
}

/** The first of `markers` (sorted by index) at or after `index`: drawing starts there and stops at the window's end. */
export function firstMarkerFrom(markers: readonly { index: number }[], index: number): number {
  let lo = 0;
  let hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].index < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---- Live updates ----

/** The camera counts as "at the newest book" within this many books of it. */
export const NEWEST_SLACK = 0.5;

/** Whether the camera (going to `target`) is at the newest book of `count`. */
export function atNewest(target: number, count: number): boolean {
  return count > 0 && target >= count - 1 - NEWEST_SLACK;
}

/**
 * Where the camera goes when the pile changes (a new read, a confirmed one, an undo). If the
 * reader was at the newest book, the camera goes to the new newest book (it eases from the book
 * it was on). Otherwise the book they were looking at stays in front of them, wherever it is now
 * in the pile; if that book has gone, the nearest older one that's still there takes its place.
 * `target` and `shown` are camera positions (book indexes, oldest first, may be fractional).
 */
export function followUpdate(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
  target: number,
  shown: number,
): { target: number; shown: number } {
  const count = nextKeys.length;
  if (count === 0) return { target: 0, shown: 0 };
  if (prevKeys.length === 0) return { target: count - 1, shown: count - 1 };
  const indexOf = new Map(nextKeys.map((key, i) => [key, i]));
  const max = count - 1;
  const clamp = (x: number) => Math.min(max, Math.max(0, x));
  const carry = (position: number) => {
    const at = Math.min(prevKeys.length - 1, Math.max(0, Math.round(position)));
    const offset = position - at;
    for (let i = at; i >= 0; i--) {
      const moved = indexOf.get(prevKeys[i]);
      if (moved !== undefined) return clamp(moved + (i === at ? offset : 0));
    }
    // Everything at and under it has gone: the bottom of the pile.
    return 0;
  };
  const nextShown = carry(shown);
  if (atNewest(target, prevKeys.length)) return { target: max, shown: nextShown };
  return { target: carry(target), shown: nextShown };
}

/**
 * followUpdate for the pile as the screen uses it. A one-book pile opens on its base book, so
 * as it grows the camera stays on that book; otherwise followUpdate's rules apply: on the base
 * book it stays there, at the newest it follows the newest, anywhere else the reader's book stays
 * in front of them (also when the pile grows too tall to fit above the eye line: no jump).
 */
export function followPile(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
  target: number,
  shown: number,
): { target: number; shown: number } {
  if (prevKeys.length === 1) {
    const at = nextKeys.indexOf(prevKeys[0]);
    if (at >= 0) return { target: at, shown: at };
  }
  return followUpdate(prevKeys, nextKeys, target, shown);
}

// ---- The screen reader list ----

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** A read's date for people ("November 24, 2026" in en), in the household's time zone. */
export function readDate(iso: string, zone: string, locale: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const key = `${locale}|${zone}`;
  let format = dayFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' });
    dayFormats.set(key, format);
  }
  return format.format(ms);
}

/** One line of the list: "Step 42, Moon Soup, read by Pip, November 24, 2026". */
export function stackListText(
  item: StackItem,
  readerName: string,
  zone: string,
  text: { locale: string; template: string },
): string {
  return fmt(text.template, {
    step: item.step.toLocaleString(text.locale),
    title: item.title,
    reader: readerName,
    date: readDate(item.firstReadAt, zone, text.locale),
  });
}
