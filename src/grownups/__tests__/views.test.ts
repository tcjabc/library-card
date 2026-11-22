import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadSummary, Reader } from '../../data';
import { matchesBookSearch } from '../../lib/search';
import { readViewChoice, writeViewChoice } from '../../lib/viewChoice';
import { filterBooks, readersByBook, sortBooks } from '../booksView';
import { isAppStorageKey } from '../helpers';
import { GROWN_UP_VIEW_DEFAULTS, grownUpViewKey } from '../views';

// Grown-ups → Grid / List: the Books tab's sort and quick filters, and the remembered view choice.

const book = (title: string, addedAt: string, reads = 0, coverUrl: string | null = 'blob:x') => ({ title, addedAt, reads, coverUrl });
const books = [
  book('The Gruffalo', '2026-03-01T10:00:00Z', 3),
  book('apple pie ABC', '2026-03-05T10:00:00Z', 0, null),
  book('Book 10', '2026-01-01T10:00:00Z', 1),
  book('Book 2', '2026-02-01T10:00:00Z', 0),
  book('Émile and the Detectives', '2026-02-15T10:00:00Z', 0, null),
];
const titles = (list: readonly { title: string }[]) => list.map((b) => b.title);

describe('Books: sort', () => {
  it('Recently added: newest first', () => {
    expect(titles(sortBooks(books, 'recent'))).toEqual(['apple pie ABC', 'The Gruffalo', 'Émile and the Detectives', 'Book 2', 'Book 10']);
  });

  it('Title A–Z: case and accents aside, numbers in order', () => {
    expect(titles(sortBooks(books, 'title'))).toEqual(['apple pie ABC', 'Book 2', 'Book 10', 'Émile and the Detectives', 'The Gruffalo']);
  });

  it('does not change the list it is given', () => {
    const copy = [...books];
    sortBooks(books, 'title');
    expect(books).toEqual(copy);
  });
});

describe('Books: quick filters, with search and sort', () => {
  it('All / Not read by anyone / No cover', () => {
    expect(filterBooks(books, 'all')).toHaveLength(5);
    expect(titles(filterBooks(books, 'unread'))).toEqual(['apple pie ABC', 'Book 2', 'Émile and the Detectives']);
    expect(titles(filterBooks(books, 'nocover'))).toEqual(['apple pie ABC', 'Émile and the Detectives']);
  });

  it('search, then filter, then sort (as the tab does)', () => {
    const run = (search: string, filter: 'all' | 'unread' | 'nocover', sort: 'recent' | 'title') =>
      titles(sortBooks(filterBooks(books.filter((b) => matchesBookSearch({ title: b.title, authors: [] }, search)), filter), sort));
    expect(run('book', 'all', 'title')).toEqual(['Book 2', 'Book 10']);
    expect(run('book', 'unread', 'recent')).toEqual(['Book 2']);
    expect(run('e', 'nocover', 'title')).toEqual(['apple pie ABC', 'Émile and the Detectives']);
    expect(run('emile', 'unread', 'recent')).toEqual(['Émile and the Detectives']);
    expect(run('zebra', 'all', 'recent')).toEqual([]);
  });
});

describe('Books: who has read each book', () => {
  const reader = (id: string, name: string): Reader =>
    ({ id, household_id: 'h', display_name: name, avatar: '🦊', kind: 'child', needs_check: true, card_token: id, active_journey_id: null }) as Reader;
  const summary = (reader_id: string, isbn: string, count = 1): ReadSummary =>
    ({ reader_id, isbn, count, first_read_at: '2026-01-01T00:00:00Z', last_read_at: '2026-01-01T00:00:00Z' }) as ReadSummary;

  it('in the household’s reader order, once each, unknown readers left out', () => {
    const readers = [reader('a', 'Ada'), reader('b', 'Ben'), reader('c', 'Cy')];
    const map = readersByBook([summary('c', 'x'), summary('a', 'x', 4), summary('zz', 'x'), summary('b', 'y')], readers);
    expect(map.get('x')?.map((r) => r.display_name)).toEqual(['Ada', 'Cy']);
    expect(map.get('y')?.map((r) => r.display_name)).toEqual(['Ben']);
    expect(map.get('z')).toBeUndefined();
  });
});

describe('the remembered Grid / List choice', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubStorage = () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    return data;
  };

  it('each grown-up tab has its own default: Books Grid, the others List', () => {
    expect(GROWN_UP_VIEW_DEFAULTS).toEqual({ books: 'grid', readers: 'list', libraries: 'list', loans: 'list', cards: 'list', notes: 'list' });
    const keys = Object.keys(GROWN_UP_VIEW_DEFAULTS).map((tab) => grownUpViewKey(tab as keyof typeof GROWN_UP_VIEW_DEFAULTS));
    expect(new Set(keys).size).toBe(6);
    // Under the library-card: prefix, so "Reset this device" clears them.
    expect(keys.every(isAppStorageKey)).toBe(true);
  });

  it('per tab, on this device; only a choice other than the default is stored', () => {
    const data = stubStorage();
    const books = grownUpViewKey('books');
    const loans = grownUpViewKey('loans');
    expect([readViewChoice(books, 'grid'), readViewChoice(loans, 'list')]).toEqual(['grid', 'list']);
    writeViewChoice(books, 'list', 'grid');
    writeViewChoice(loans, 'grid', 'list');
    expect([readViewChoice(books, 'grid'), readViewChoice(loans, 'list'), readViewChoice(grownUpViewKey('readers'), 'list')]).toEqual(['list', 'grid', 'list']);
    writeViewChoice(books, 'grid', 'grid');
    expect([...data.keys()]).toEqual([loans]);
  });

  it('ignores a stored value it does not know, and storage that is blocked', () => {
    const data = stubStorage();
    data.set(grownUpViewKey('cards'), 'carousel');
    expect(readViewChoice(grownUpViewKey('cards'), 'list')).toBe('list');
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(() => writeViewChoice(grownUpViewKey('cards'), 'grid', 'list')).not.toThrow();
    expect(readViewChoice(grownUpViewKey('cards'), 'list')).toBe('list');
  });
});
