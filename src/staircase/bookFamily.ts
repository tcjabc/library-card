import type { Book, Collection, Id, Library, Loan, Reader, ReadSummary } from '../data';
import type { StackItem } from './stackItems';

/**
 * The family's own part of the Family Staircase's book sheet, from data the app already keeps
 * (pure, unit-tested): whose first read the pile book is and when, its number on the pile, how
 * many times each reader has read it, whether it's a home book or out on loan, and its collection.
 *
 * Reads are the read summaries, which only ever count CONFIRMED reads (a read still waiting for
 * a grown-up isn't in them), the same as the pile itself.
 */

export interface FamilyReader {
  readerId: Id;
  name: string;
  avatar: string;
}

export interface FamilyLoan {
  /** The library's name, or null when the loan names none. */
  library: string | null;
  borrower: FamilyReader;
  /** "YYYY-MM-DD", or null. */
  due: string | null;
}

export interface FamilyPart {
  /**
   * The pile book's own reader and their first confirmed read of it (the stack item's), as "Book
   * #N" is: not the household's earliest read of the title, which may be another reader's book.
   */
  first: FamilyReader & { at: string };
  /** The stack item's number on the pile ("Book #N"). */
  step: number;
  /** Each reader who has read it, with their confirmed reads, first reader first. */
  reads: (FamilyReader & { count: number })[];
  /** Confirmed reads by everyone. */
  total: number;
  /** On the household's home shelf. */
  home: boolean;
  /** Out on loan now (not returned), soonest due first. */
  loans: FamilyLoan[];
  collection: { title: string; volume: number | null } | null;
}

export interface FamilyInput {
  item: Pick<StackItem, 'isbn' | 'step' | 'readerId' | 'firstReadAt'>;
  summaries: readonly ReadSummary[];
  readers: readonly Reader[];
  loans: readonly Loan[];
  libraries: readonly Library[];
  /** Book keys on the household's home shelf. */
  homeIsbns: ReadonlySet<string>;
  book: Pick<Book, 'collection_id' | 'volume'> | null | undefined;
  collections: readonly Collection[];
  /** For a reader who has gone (or has no name). */
  someone: { name: string; avatar: string };
}

/** The earliest read first; ties by reader id, as staircaseOrder does. */
const byFirstRead = (a: ReadSummary, b: ReadSummary) =>
  a.first_read_at.localeCompare(b.first_read_at) || a.reader_id.localeCompare(b.reader_id);

/** Soonest due first, no due date last, then the earliest borrowed. */
const byDue = (a: Loan, b: Loan) =>
  (a.due_date === null ? 1 : 0) - (b.due_date === null ? 1 : 0) ||
  (a.due_date ?? '').localeCompare(b.due_date ?? '') ||
  a.borrowed_at.localeCompare(b.borrowed_at);

export function familyPart(input: FamilyInput): FamilyPart {
  const { item, someone } = input;
  const readers = new Map(input.readers.map((r) => [r.id, r]));
  const who = (id: Id): FamilyReader => {
    const r = readers.get(id);
    return { readerId: id, name: r?.display_name.trim() || someone.name, avatar: r?.avatar || someone.avatar };
  };

  const mine = input.summaries.filter((s) => s.isbn === item.isbn && s.count > 0).sort(byFirstRead);
  const reads = mine.map((s) => ({ ...who(s.reader_id), count: s.count }));
  const first = { ...who(item.readerId), at: item.firstReadAt };

  const libraries = new Map(input.libraries.map((l) => [l.id, l.name]));
  const loans = input.loans
    .filter((l) => l.isbn === item.isbn && l.returned_at === null)
    .sort(byDue)
    .map((l) => ({
      library: (l.library_id ? libraries.get(l.library_id) : undefined)?.trim() || l.library_name?.trim() || null,
      borrower: who(l.reader_id),
      due: l.due_date,
    }));

  const collectionId = input.book?.collection_id ?? null;
  const collection = collectionId ? input.collections.find((c) => c.id === collectionId) : undefined;

  return {
    first,
    step: item.step,
    reads,
    total: reads.reduce((sum, r) => sum + r.count, 0),
    home: input.homeIsbns.has(item.isbn),
    loans,
    collection: collection ? { title: collection.title, volume: input.book?.volume ?? null } : null,
  };
}
