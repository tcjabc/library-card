/**
 * Book search, shared by Grown-ups → Books and the kids' My Bookshelf and Library Books (pure,
 * unit-tested). Case, accents, spaces and punctuation don't count, and there are no word
 * boundaries, so a part of a word (or of CJK text, which has no spaces) matches too.
 */

/** Lower case, accents and punctuation removed, so "Pépé" matches "pepe". */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Searchable {
  title: string;
  authors: readonly string[];
}

/**
 * Every word of the query appears in the title or an author's name, or the query without its
 * spaces appears in one of them without theirs ("charlottes" finds "Charlotte's Web", "roomonthe"
 * finds "Room on the Broom"). An empty query matches everything.
 */
export function matchesBookSearch(book: Searchable, query: string): boolean {
  const folded = foldForSearch(query);
  const words = folded.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldForSearch([book.title, ...book.authors].join(' '));
  if (words.every((word) => haystack.includes(word))) return true;
  const squashed = folded.replace(/ /g, '');
  return [book.title, ...book.authors].some((field) => foldForSearch(field).replace(/ /g, '').includes(squashed));
}

/** True when the query has something to search for (not just spaces or punctuation). */
export function isSearching(query: string): boolean {
  return foldForSearch(query) !== '';
}

/** The items that match, in their order. `book` gives each item's title and authors. */
export function searchBooks<T>(items: readonly T[], query: string, book: (item: T) => Searchable): T[] {
  if (!isSearching(query)) return [...items];
  return items.filter((item) => matchesBookSearch(book(item), query));
}
