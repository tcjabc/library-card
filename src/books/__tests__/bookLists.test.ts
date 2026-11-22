import { afterEach, describe, expect, it, vi } from 'vitest';
import { loansInView } from '../../library/loans';
import { foldForSearch, isSearching, matchesBookSearch, searchBooks } from '../../lib/search';
import { isAppStorageKey, matchesBookSearch as grownUpSearch } from '../../grownups/helpers';
import { bookViewKey, getBookView, setBookView } from '../bookView';
import { everything, firstRows, VIRTUALISE_OVER, windowRange } from '../listWindow';
import { filterShelf } from '../shelfFilter';

// The kids' book lists: "Find a book", the filters it combines with, Grid / List, and the List's window.

const books = [
  { title: 'The Gruffalo', authors: ['Julia Donaldson', 'Axel Scheffler'], read: true },
  { title: 'Pépé le Moko', authors: [], read: false },
  { title: 'はらぺこあおむし', authors: ['エリック・カール'], read: true },
  { title: '好饿的毛毛虫', authors: ['艾瑞·卡尔'], read: false },
  { title: 'Room on the Broom', authors: ['Julia Donaldson'], read: false },
  { title: "Charlotte's Web", authors: ['E. B. White'], read: true },
];
const titles = (list: readonly { title: string }[]) => list.map((b) => b.title);

describe('Find a book', () => {
  it('matches the title or an author, ignoring case, accents, spaces and punctuation', () => {
    expect(titles(searchBooks(books, 'GRUFFALO', (b) => b))).toEqual(['The Gruffalo']);
    expect(titles(searchBooks(books, 'pepe', (b) => b))).toEqual(['Pépé le Moko']);
    expect(titles(searchBooks(books, 'donaldson', (b) => b))).toEqual(['The Gruffalo', 'Room on the Broom']);
    expect(titles(searchBooks(books, 'charlottes', (b) => b))).toEqual(["Charlotte's Web"]);
    expect(titles(searchBooks(books, 'roomonthe', (b) => b))).toEqual(['Room on the Broom']);
    expect(titles(searchBooks(books, 'room ont hebroom', (b) => b))).toEqual(['Room on the Broom']);
    expect(titles(searchBooks(books, 'e.b. white', (b) => b))).toEqual(["Charlotte's Web"]);
    expect(titles(searchBooks(books, 'scheff gruff', (b) => b))).toEqual(['The Gruffalo']);
    expect(titles(searchBooks(books, 'dragon', (b) => b))).toEqual([]);
  });

  it('finds part of CJK text (no spaces between words)', () => {
    expect(titles(searchBooks(books, 'あおむし', (b) => b))).toEqual(['はらぺこあおむし']);
    expect(titles(searchBooks(books, 'ぺこ', (b) => b))).toEqual(['はらぺこあおむし']);
    expect(titles(searchBooks(books, '毛毛虫', (b) => b))).toEqual(['好饿的毛毛虫']);
    expect(titles(searchBooks(books, 'カール', (b) => b))).toEqual(['はらぺこあおむし']);
  });

  it('an empty or punctuation-only search shows everything; the grown-up search is the same function', () => {
    expect(searchBooks(books, '', (b) => b)).toHaveLength(books.length);
    expect(searchBooks(books, '  ?! ', (b) => b)).toHaveLength(books.length);
    expect([isSearching(''), isSearching(' - '), isSearching('a')]).toEqual([false, false, true]);
    expect(grownUpSearch).toBe(matchesBookSearch);
    expect(foldForSearch('  Élan—Vital!  ')).toBe('elan vital');
  });

  it('combines with All / Read / Not read: the chips count what the search found', () => {
    const run = (search: string, filter: 'all' | 'read' | 'unread') => filterShelf(books, search, filter, (b) => b, (b) => b.read);
    expect(titles(run('donaldson', 'all').visible)).toEqual(['The Gruffalo', 'Room on the Broom']);
    expect(titles(run('donaldson', 'read').visible)).toEqual(['The Gruffalo']);
    expect(titles(run('donaldson', 'unread').visible)).toEqual(['Room on the Broom']);
    expect([run('donaldson', 'unread').found.length, run('donaldson', 'unread').readCount]).toEqual([2, 1]);
    expect(run('', 'read').visible).toHaveLength(3);
    expect(run('dragon', 'all').visible).toEqual([]);
  });

  it('combines with Mine / My house and the returned books', () => {
    const loans = [
      { id: 'a', reader_id: 'ada', isbn: 'gruffalo', returned_at: null, due_date: null, borrowed_at: '2026-01-01T00:00:00Z' },
      { id: 'b', reader_id: 'ben', isbn: 'broom', returned_at: null, due_date: null, borrowed_at: '2026-01-02T00:00:00Z' },
      { id: 'c', reader_id: 'ada', isbn: 'broom', returned_at: '2026-01-05T00:00:00Z', due_date: null, borrowed_at: '2026-01-01T00:00:00Z' },
    ];
    const bookOf = (loan: { isbn: string }) => (loan.isbn === 'gruffalo' ? books[0] : books[4]);
    const find = (view: 'mine' | 'house', search: string) => {
      const { active, returned } = loansInView(loans as never, view, 'ada');
      return { active: searchBooks(active, search, bookOf).map((l) => l.id), returned: searchBooks(returned, search, bookOf).map((l) => l.id) };
    };
    expect(find('mine', 'broom')).toEqual({ active: [], returned: ['c'] });
    expect(find('house', 'broom')).toEqual({ active: ['b'], returned: ['c'] });
    expect(find('house', 'gruffalo')).toEqual({ active: ['a'], returned: [] });
  });
});

describe('Grid / List', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is Grid until List is chosen, per screen and per reader, on this device', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    expect(getBookView('shelf', 'ada')).toBe('grid');
    setBookView('shelf', 'ada', 'list');
    expect([getBookView('shelf', 'ada'), getBookView('library', 'ada'), getBookView('shelf', 'ben')]).toEqual(['list', 'grid', 'grid']);
    // Under the library-card: prefix, so "Reset this device" clears it.
    expect([...data.keys()].every(isAppStorageKey)).toBe(true);
    expect(data.has(bookViewKey('shelf', 'ada'))).toBe(true);
    setBookView('shelf', 'ada', 'grid');
    expect(data.size).toBe(0);
  });

  it('falls back to Grid when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(() => setBookView('library', 'ada', 'list')).not.toThrow();
    expect(getBookView('library', 'ada')).toBe('grid');
  });
});

describe('the List window (over 60 rows)', () => {
  const rows = (n: number, h = 100) => Array.from({ length: n }, () => h);

  it('renders only the rows near the screen, with padding for the rest', () => {
    // 130 rows of 100 px; the screen (800 px) starts 3000 px down the list; 800 px extra each way.
    const range = windowRange(rows(130), 3000, 800, 800);
    expect(range).toEqual({ start: 22, end: 46, padTop: 2200, padBottom: 8400 });
    expect(range.padTop + (range.end - range.start) * 100 + range.padBottom).toBe(13000);
  });

  it('copes with rows of different heights, the top and the end of the list', () => {
    const mixed = [80, 120, 80, 120, 80, 120];
    expect(windowRange(mixed, 0, 100, 0)).toEqual({ start: 0, end: 2, padTop: 0, padBottom: 400 });
    expect(windowRange(mixed, 190, 50, 0)).toEqual({ start: 1, end: 3, padTop: 80, padBottom: 320 });
    expect(windowRange(mixed, -5000, 800, 0)).toEqual({ start: 0, end: 1, padTop: 0, padBottom: 520 });
    expect(windowRange(mixed, 99999, 800, 0)).toEqual({ start: 5, end: 6, padTop: 480, padBottom: 0 });
    expect(windowRange([], 0, 800)).toEqual(everything(0));
  });

  it('starts with the first rows; short lists are never windowed', () => {
    expect(VIRTUALISE_OVER).toBe(60);
    expect(firstRows(130)).toEqual({ start: 0, end: 30, padTop: 0, padBottom: 0 });
    expect(firstRows(10).end).toBe(10);
  });
});
