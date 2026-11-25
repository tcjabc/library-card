import { matchesBookSearch } from '../lib/search';
import { fmt, strings } from '../strings';
import type { Book, BookCollectionEntry, BookKey, Collection, DataStore, Id } from '../data';

/**
 * Picking books that already exist for a set (pure, unit-tested): the household's books (at Home
 * or ever borrowed), which set each is in now, ticked in order, and what saving them would do.
 */

/** How many rows the picker shows at most; past that, "keep typing". */
export const PICK_ROWS_SHOWN = 50;

export interface PickCandidate {
  book: Book;
  /** On the Home shelf (false: only borrowed). */
  atHome: boolean;
  /** The set it is in now (one that still exists), else null. */
  fromSet: { id: Id; title: string } | null;
}

/**
 * The household's books for the picker, by title: every Home book and every book ever borrowed,
 * once each. `exceptSet`: the set being filled (its own books aren't offered).
 */
export function pickCandidates(
  books: readonly Book[],
  homeIsbns: ReadonlySet<BookKey>,
  collections: readonly Collection[],
  exceptSet: Id | null = null,
): PickCandidate[] {
  const titles = new Map(collections.map((c) => [c.id, c.title]));
  const seen = new Set<BookKey>();
  const out: PickCandidate[] = [];
  for (const book of books) {
    if (seen.has(book.isbn)) continue;
    seen.add(book.isbn);
    const setId = book.collection_id ?? null;
    if (setId !== null && setId === exceptSet) continue;
    // A collection_id no set answers to (deleted on another device) is a loose book.
    const title = setId !== null ? titles.get(setId) : undefined;
    out.push({ book, atHome: homeIsbns.has(book.isbn), fromSet: setId !== null && title !== undefined ? { id: setId, title } : null });
  }
  return out.sort((a, b) => a.book.title.localeCompare(b.book.title) || a.book.isbn.localeCompare(b.book.isbn));
}

/** Loads the picker's books through the DataStore: Home plus ever borrowed (as the loan editor does). */
export async function loadPickCandidates(store: DataStore, householdId: Id, exceptSet: Id | null = null): Promise<PickCandidate[]> {
  const [home, loans, collections] = await Promise.all([store.listHomeItems(householdId), store.listLoans(householdId), store.listCollections(householdId)]);
  const keys = [...new Set([...home.map((h) => h.isbn), ...loans.map((l) => l.isbn)])];
  const books = await store.getBooks(keys);
  return pickCandidates(books, new Set(home.map((h) => h.isbn)), collections, exceptSet);
}

/** Ticks or unticks a book; the ticked ones stay in the order they were ticked. */
export function togglePick(picked: readonly BookKey[], isbn: BookKey): BookKey[] {
  return picked.includes(isbn) ? picked.filter((k) => k !== isbn) : [...picked, isbn];
}

/** The rows to show for a search: the matches, at most `cap`, and how many matched in all. */
export function shownCandidates(candidates: readonly PickCandidate[], query: string, cap = PICK_ROWS_SHOWN): { rows: PickCandidate[]; matched: number } {
  const matches = candidates.filter((c) => matchesBookSearch(c.book, query));
  return { rows: matches.slice(0, cap), matched: matches.length };
}

export interface PickSummary {
  count: number;
  /** Ticked books now in another set (they would move). */
  moving: number;
  /** Ticked books that aren't at Home (they would be added to Home). */
  borrowed: number;
}

export function pickSummary(picked: readonly BookKey[], candidates: readonly PickCandidate[]): PickSummary {
  const byKey = new Map(candidates.map((c) => [c.book.isbn, c]));
  const ticked = picked.map((k) => byKey.get(k)).filter((c): c is PickCandidate => c !== undefined);
  return { count: ticked.length, moving: ticked.filter((c) => c.fromSet !== null).length, borrowed: ticked.filter((c) => !c.atHome).length };
}

/** The one confirm before saving, when ticked books would move out of other sets; null: no confirm. */
export function moveConfirmTitle(summary: PickSummary): string | null {
  if (summary.moving === 0) return null;
  return summary.moving === 1 ? strings.collections.moveTitleOne : fmt(strings.collections.moveTitle, { count: summary.moving });
}

/** What to save: the ticked books in tick order, numbered 1…N, or (not numbered) with no number. */
export function pickEntries(picked: readonly BookKey[], numbered: boolean): BookCollectionEntry[] {
  return picked.map((isbn, i) => ({ isbn, volume: numbered ? i + 1 : null }));
}

/** "How many books": the user's text once they have typed in it (even emptied), else the number ticked (empty for none). */
export function expectedText(typed: string | null, pickedCount: number): string {
  if (typed !== null) return typed;
  return pickedCount > 0 ? String(pickedCount) : '';
}
