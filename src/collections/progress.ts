import { MAX_EXPECTED_COUNT, MAX_VOLUME } from '../data';

/**
 * Collections (box sets and series), worked out per reader and never stored (pure, unit-tested).
 *
 * A collection's books sit in numbered slots ("volumes"); several editions may share a number.
 * A slot counts as read when ANY edition in it has a confirmed read by the reader (read summaries
 * hold confirmed reads only, so a read waiting for a grown-up doesn't count). With an expected
 * count, progress is the read slots among 1…expected out of expected, and the set is locked 🔒
 * until every one of them is read, then earns its trophy 🏆. Without one, progress is the read
 * slots out of the slots there are, and there is no trophy. Undoing or rejecting a read just
 * changes the summaries, so the set locks again by itself.
 */

export interface MemberLike {
  isbn: string;
  volume?: number | null;
}

export interface Slot<T> {
  /** The number, or null for a book without one (each such book is its own slot). */
  volume: number | null;
  /** The editions in this slot, the primary (first added) first. Empty: a number not added yet. */
  books: T[];
}

/**
 * The slots, in order: numbered ones by number (with the empty numbers up to the expected count
 * filled in), then the unnumbered books. In each slot the first-added edition comes first
 * (`addedAt`: when it came Home; unknown last), then by book key.
 */
export function buildSlots<T extends MemberLike>(members: readonly T[], expected: number | null, addedAt: (m: T) => string | null = () => null): Slot<T>[] {
  const byNumber = new Map<number, T[]>();
  const unnumbered: T[] = [];
  for (const m of members) {
    if (m.volume == null) unnumbered.push(m);
    else byNumber.set(m.volume, [...(byNumber.get(m.volume) ?? []), m]);
  }
  for (let v = 1; v <= (expected ?? 0); v++) if (!byNumber.has(v)) byNumber.set(v, []);
  const firstAdded = (a: T, b: T) => {
    const x = addedAt(a);
    const y = addedAt(b);
    if (x !== y) return x === null ? 1 : y === null ? -1 : x.localeCompare(y);
    return a.isbn.localeCompare(b.isbn);
  };
  return [
    ...[...byNumber.entries()].sort(([a], [b]) => a - b).map(([volume, books]) => ({ volume, books: [...books].sort(firstAdded) })),
    ...[...unnumbered].sort(firstAdded).map((m) => ({ volume: null, books: [m] })),
  ];
}

/** Whether the reader has read any edition in the slot (confirmed reads: the summaries' keys). */
export const slotRead = <T extends MemberLike>(slot: Slot<T>, readIsbns: ReadonlySet<string>) => slot.books.some((b) => readIsbns.has(b.isbn));

export interface Progress {
  /** Read slots (with an expected count: among 1…expected). */
  read: number;
  /** The expected count, or (without one) the slots that have a book. */
  total: number;
  /** Has an expected count and not every slot of it is read. */
  locked: boolean;
  /** Every expected slot is read: "Whole set read!" (never without an expected count). */
  trophy: boolean;
  /** Counts as read on the shelf: the trophy, or (without an expected count) every slot there is read. */
  complete: boolean;
}

export function collectionProgress<T extends MemberLike>(slots: readonly Slot<T>[], readIsbns: ReadonlySet<string>, expected: number | null): Progress {
  if (expected != null) {
    const counted = slots.filter((s) => s.volume !== null && s.volume >= 1 && s.volume <= expected);
    const read = counted.filter((s) => slotRead(s, readIsbns)).length;
    const trophy = read >= expected;
    return { read, total: expected, locked: !trophy, trophy, complete: trophy };
  }
  const present = slots.filter((s) => s.books.length > 0);
  const read = present.filter((s) => slotRead(s, readIsbns)).length;
  return { read, total: present.length, locked: false, trophy: false, complete: present.length > 0 && read === present.length };
}

/** The smallest number from 1 not in `taken`. */
export function nextFreeVolume(taken: Iterable<number | null | undefined>): number {
  const used = new Set(taken);
  let v = 1;
  while (used.has(v) && v < MAX_VOLUME) v++;
  return v;
}

/** How many numbers are still missing: "2 books still to add". 0 without an expected count. */
export function stillToAdd<T extends MemberLike>(slots: readonly Slot<T>[], expected: number | null): number {
  if (expected == null) return 0;
  return slots.filter((s) => s.volume !== null && s.volume <= expected && s.books.length === 0).length;
}

/**
 * Quick-add (books without barcodes): `count` books on the next free numbers, named by the titles
 * given one per line, or "<set title> <number>". A count of 0 (or none) takes one per title.
 */
export function quickAddPlan(setTitle: string, count: number, titlesText: string, taken: Iterable<number | null | undefined>): { volume: number; title: string }[] {
  const titles = titlesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const n = Math.min(MAX_EXPECTED_COUNT, Number.isInteger(count) && count > 0 ? count : titles.length);
  const used = new Set(taken);
  const plan: { volume: number; title: string }[] = [];
  for (let i = 0; i < n; i++) {
    const volume = nextFreeVolume(used);
    used.add(volume);
    plan.push({ volume, title: titles[i] ?? `${setTitle.trim()} ${volume}` });
  }
  return plan;
}
