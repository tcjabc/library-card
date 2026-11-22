import { describe, expect, it } from 'vitest';
import {
  GROWN_UP_TABS,
  formatBytes,
  findSameTitle,
  formatTimestampDate,
  isAppStorageKey,
  matchesBookSearch,
  paginate,
  parseGrownUpsPath,
  readStats,
  sortActiveLoans,
  sortReturnedLoans,
  tabPath,
  titleKey,
} from '../helpers';

describe('parseGrownUpsPath and tabPath', () => {
  it('reads the tab from the path', () => {
    expect(GROWN_UP_TABS.map((tab) => parseGrownUpsPath(`/grownups/${tab}`))).toEqual([...GROWN_UP_TABS]);
    expect(parseGrownUpsPath('/grownups/loans/')).toBe('loans');
  });

  it('is null for the root, an unknown tab or another area', () => {
    expect([parseGrownUpsPath('/grownups'), parseGrownUpsPath('/grownups/nope'), parseGrownUpsPath('/hub'), parseGrownUpsPath('/grownupsx/books')]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('builds paths, with an optional query', () => {
    expect(tabPath('books')).toBe('/grownups/books');
    expect(tabPath('loans', { reader: 'a b' })).toBe('/grownups/loans?reader=a+b');
  });
});

describe('matchesBookSearch', () => {
  const book = { title: 'The Gruffalo’s Child', authors: ['Julia Donaldson', 'Axel Scheffler'] };

  it('matches title and author words, in any order and case', () => {
    expect(matchesBookSearch(book, 'gruffalo')).toBe(true);
    expect(matchesBookSearch(book, 'DONALDSON child')).toBe(true);
    expect(matchesBookSearch(book, 'scheff')).toBe(true);
    expect(matchesBookSearch(book, 'dragon')).toBe(false);
  });

  it('ignores accents and punctuation', () => {
    expect(matchesBookSearch({ title: 'Pépé le Moko', authors: [] }, 'pepe')).toBe(true);
    expect(matchesBookSearch(book, 'gruffalo’s')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesBookSearch(book, '   ')).toBe(true);
  });
});

describe('titleKey and findSameTitle', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(titleKey('The Gruffalo!')).toBe(titleKey('the   gruffalo'));
    expect(titleKey('Room on the Broom')).toBe(titleKey('ROOM ON THE BROOM.'));
    expect(titleKey('Can’t Sleep, Little Bear?')).toBe(titleKey('cant sleep little bear'));
    expect(titleKey('Pépé')).toBe(titleKey('pepe'));
    expect(titleKey('Thegruffalo')).toBe(titleKey('The Gruffalo'));
  });

  it('keeps letters of any script and digits', () => {
    expect(titleKey('小王子')).toBe(titleKey(' 小 王子 '));
    expect(titleKey('小王子')).not.toBe(titleKey('大王子'));
    expect(titleKey('Book 1')).not.toBe(titleKey('Book 2'));
  });

  it('finds every item with the same title, and nothing for a different one', () => {
    const shelf = [
      { id: 'a', title: 'The Gruffalo' },
      { id: 'b', title: 'The Gruffalo’s Child' },
      { id: 'c', title: 'the gruffalo' },
    ];
    expect(findSameTitle('THE GRUFFALO!', shelf).map((i) => i.id)).toEqual(['a', 'c']);
    expect(findSameTitle('Gruffalo', shelf)).toEqual([]);
    expect(findSameTitle('Stick Man', shelf)).toEqual([]);
  });

  it('a title with no letters or digits matches nothing', () => {
    expect(findSameTitle(' ?! ', [{ title: '!!' }, { title: '' }])).toEqual([]);
  });
});

describe('sortActiveLoans', () => {
  const today = '2026-03-10';
  const loan = (id: string, due_date: string | null, borrowed_at = '2026-03-01T00:00:00Z') => ({ id, due_date, borrowed_at });

  it('overdue first, then due soon, then later, then no due date', () => {
    const loans = [loan('none', null), loan('later', '2026-04-01'), loan('soon', '2026-03-11'), loan('over2', '2026-03-09'), loan('over1', '2026-03-01')];
    expect(sortActiveLoans(loans, today).map((l) => l.id)).toEqual(['over1', 'over2', 'soon', 'later', 'none']);
  });

  it('same due date: newest borrowed first; leaves the input alone', () => {
    const loans = [loan('old', '2026-04-01', '2026-01-01T00:00:00Z'), loan('new', '2026-04-01', '2026-02-01T00:00:00Z')];
    expect(sortActiveLoans(loans, today).map((l) => l.id)).toEqual(['new', 'old']);
    expect(loans[0].id).toBe('old');
  });
});

describe('sortReturnedLoans', () => {
  it('most recently returned first', () => {
    const loans = [
      { id: 'a', returned_at: '2026-01-01T00:00:00Z' },
      { id: 'b', returned_at: '2026-03-01T00:00:00Z' },
      { id: 'c', returned_at: '2026-02-01T00:00:00Z' },
    ];
    expect(sortReturnedLoans(loans).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('readStats', () => {
  it('counts books and re-reads', () => {
    expect(readStats([{ count: 1 }, { count: 3 }, { count: 2 }])).toEqual({ booksRead: 3, rereads: 3 });
    expect(readStats([])).toEqual({ booksRead: 0, rereads: 0 });
  });
});

describe('paginate', () => {
  it('splits into pages of 10', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(items, 10).map((p) => p.length)).toEqual([10, 10, 3]);
    expect(paginate([], 10)).toEqual([]);
    expect(() => paginate(items, 0)).toThrow();
  });
});

describe('formatting', () => {
  it('formatTimestampDate shows the local calendar day', () => {
    // 03:30 UTC on 1 March is still 28 February in New York (the test time zone).
    expect(formatTimestampDate('2026-03-01T03:30:00Z', 'en-GB', new Date('2026-06-01T12:00:00Z'))).toBe('Sat 28 Feb');
  });

  it('formatBytes', () => {
    expect([formatBytes(512), formatBytes(1536), formatBytes(250 * 1024), formatBytes(3.2 * 1024 * 1024)]).toEqual([
      '512 B',
      '1.5 KB',
      '250 KB',
      '3.2 MB',
    ]);
  });

  it('isAppStorageKey', () => {
    expect([isAppStorageKey('library-card:active-reader'), isAppStorageKey('library-card:celebrate:x'), isAppStorageKey('other')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
