import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Loan } from '../../data';
import { isAppStorageKey } from '../../grownups/helpers';
import { getLibraryView, setLibraryView } from '../libraryView';
import { checkLoanDates, currentLoansOf, dateToTimestamp, loansInView, timestampToDate } from '../loans';

const loan = (id: string, over: Partial<Loan> = {}): Loan => ({
  id,
  household_id: 'main',
  reader_id: 'ada',
  isbn: '9780000000002',
  library_id: null,
  library_name: null,
  sticker_barcode: null,
  borrowed_at: '2026-05-01T10:00:00.000Z',
  due_date: null,
  returned_at: null,
  renew_count: 0,
  ...over,
});

describe('loansInView: Mine / My house', () => {
  const loans = [
    loan('a-late', { due_date: '2026-06-20' }),
    loan('b-soon', { reader_id: 'ben', due_date: '2026-06-01' }),
    loan('a-none'),
    loan('a-soon', { due_date: '2026-06-05' }),
    loan('a-back', { returned_at: '2026-05-20T10:00:00.000Z' }),
    loan('b-back', { reader_id: 'ben', returned_at: '2026-05-25T10:00:00.000Z' }),
  ];

  it('Mine: only this reader, current loans by due date (none last), returned newest first', () => {
    const { active, returned } = loansInView(loans, 'mine', 'ada');
    expect(active.map((l) => l.id)).toEqual(['a-soon', 'a-late', 'a-none']);
    expect(returned.map((l) => l.id)).toEqual(['a-back']);
  });

  it('My house: every current loan in the household by due date, and every returned one', () => {
    const { active, returned } = loansInView(loans, 'house', 'ada');
    expect(active.map((l) => l.id)).toEqual(['b-soon', 'a-soon', 'a-late', 'a-none']);
    expect(returned.map((l) => l.id)).toEqual(['b-back', 'a-back']);
  });

  it('same due date: the earlier borrowed first', () => {
    const tie = [
      loan('later', { due_date: '2026-06-01', borrowed_at: '2026-05-03T10:00:00.000Z' }),
      loan('earlier', { due_date: '2026-06-01', borrowed_at: '2026-05-02T10:00:00.000Z' }),
    ];
    expect(loansInView(tie, 'house', 'ada').active.map((l) => l.id)).toEqual(['earlier', 'later']);
  });
});

describe('currentLoansOf: "already borrowed" when borrowing', () => {
  const isbn = '9780000000019';

  it('finds current loans of the book only, the reader’s own first', () => {
    const loans = [
      loan('ben', { isbn, reader_id: 'ben', due_date: '2026-06-01' }),
      loan('ada', { isbn, reader_id: 'ada', due_date: '2026-07-01' }),
      loan('other-book', { reader_id: 'ada' }),
    ];
    expect(currentLoansOf(loans, isbn, 'ada').map((l) => l.id)).toEqual(['ada', 'ben']);
    expect(currentLoansOf(loans, isbn, 'cy').map((l) => l.id)).toEqual(['ben', 'ada']);
  });

  it('a book borrowed and returned before is not "already borrowed"', () => {
    const loans = [loan('old', { isbn, returned_at: '2026-05-20T10:00:00.000Z' })];
    expect(currentLoansOf(loans, isbn, 'ada')).toEqual([]);
  });

  it('works for a book without a barcode', () => {
    const key = 'noisbn-123';
    expect(currentLoansOf([loan('x', { isbn: key, reader_id: 'ben' })], key, 'ada').map((l) => l.id)).toEqual(['x']);
  });
});

describe('checkLoanDates: the editor’s date rules', () => {
  const today = '2026-06-10';

  it('accepts sensible dates, with or without a due or returned date', () => {
    expect(checkLoanDates({ borrowed: '2026-06-01', due: '2026-06-29', returned: null }, today)).toEqual({});
    expect(checkLoanDates({ borrowed: '2026-06-01', due: null, returned: '2026-06-10' }, today)).toEqual({});
    expect(checkLoanDates({ borrowed: today, due: today, returned: today }, today)).toEqual({});
  });

  it('refuses a borrowed or returned date in the future', () => {
    expect(checkLoanDates({ borrowed: '2026-06-11', due: null, returned: null }, today)).toEqual({ borrowed: 'future' });
    expect(checkLoanDates({ borrowed: '2026-06-01', due: null, returned: '2026-06-11' }, today)).toEqual({ returned: 'future' });
  });

  it('refuses a due or returned date before the borrowed date', () => {
    expect(checkLoanDates({ borrowed: '2026-06-05', due: '2026-06-04', returned: '2026-06-04' }, today)).toEqual({
      due: 'beforeBorrowed',
      returned: 'beforeBorrowed',
    });
  });
});

describe('editor dates and timestamps', () => {
  it('an unchanged date keeps the original timestamp; a new one is stored at local noon', () => {
    const original = '2026-05-01T07:30:00.000Z';
    const date = timestampToDate(original);
    expect(dateToTimestamp(date, original)).toBe(original);
    const moved = dateToTimestamp('2026-04-28', original);
    expect(timestampToDate(moved)).toBe('2026-04-28');
    expect(new Date(moved).getHours()).toBe(12);
    expect(timestampToDate(dateToTimestamp('2026-03-08'))).toBe('2026-03-08'); // a DST change in New York
  });
});

describe('the Library Books filter, remembered per reader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Mine by default, My house once chosen, per reader; Reset this device clears it', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    expect(getLibraryView('ada')).toBe('mine');
    setLibraryView('ada', 'house');
    expect([getLibraryView('ada'), getLibraryView('ben')]).toEqual(['house', 'mine']);
    expect([...data.keys()].every(isAppStorageKey)).toBe(true);
    setLibraryView('ada', 'mine');
    expect(data.size).toBe(0);
  });

  it('falls back to Mine when storage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
      },
    });
    setLibraryView('ada', 'house');
    expect(getLibraryView('ada')).toBe('mine');
  });
});
