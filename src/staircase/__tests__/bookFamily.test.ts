import { describe, expect, it } from 'vitest';
import type { Collection, Library, Loan, Reader, ReadSummary } from '../../data';
import { familyPart, type FamilyInput } from '../bookFamily';

const ISBN = '9780000000002';
const OTHER = '9780000000019';

const reader = (id: string, name: string, avatar: string): Reader => ({
  id,
  household_id: 'main',
  display_name: name,
  kind: 'child',
  needs_check: true,
  avatar,
  card_token: `token-${id}`,
  active_journey_id: null,
});

const summary = (reader_id: string, isbn: string, first: string, count: number): ReadSummary => ({
  reader_id,
  isbn,
  household_id: 'main',
  first_read_at: first,
  last_read_at: first,
  count,
});

const loan = (id: string, reader_id: string, isbn: string, extra: Partial<Loan> = {}): Loan => ({
  id,
  household_id: 'main',
  reader_id,
  isbn,
  library_id: null,
  library_name: null,
  sticker_barcode: null,
  borrowed_at: '2026-11-01T02:00:00.000Z',
  due_date: '2026-11-29',
  returned_at: null,
  renew_count: 0,
  ...extra,
});

const READERS = [reader('kid-1', 'Kid One', '🦊'), reader('kid-2', 'Kid Two', '🐢'), reader('grown-1', 'Grown-up', '🦉')];
const LIBRARY: Library = { id: 'lib-1', household_id: 'main', name: 'Pretend Library', search_url_template: null, homepage_url: null, default_loan_days: 21, sticker_prefix: null };
const SET: Collection = { id: 'set-1', household_id: 'main', title: 'Moon Stories', cover_url: null, isbn: null, expected_count: 6 };

function input(over: Partial<FamilyInput> = {}): FamilyInput {
  return {
    // Kid Two's pile book: their first read of the title, after Kid One's.
    item: { isbn: ISBN, step: 42, readerId: 'kid-2', firstReadAt: '2026-03-05T10:00:00.000Z' },
    summaries: [
      summary('kid-2', ISBN, '2026-03-05T10:00:00.000Z', 1),
      summary('kid-1', ISBN, '2026-03-02T10:00:00.000Z', 3),
      summary('grown-1', OTHER, '2026-01-01T10:00:00.000Z', 9),
    ],
    readers: READERS,
    loans: [],
    libraries: [LIBRARY],
    homeIsbns: new Set(),
    book: { collection_id: null, volume: null },
    collections: [SET],
    someone: { name: 'Someone', avatar: '📖' },
    ...over,
  };
}

describe('familyPart', () => {
  it('names the pile book’s own reader and their first read, not the household’s earliest', () => {
    // Kid One read the title first (2 March), but this pile book is Kid Two's (5 March).
    expect(familyPart(input()).first).toEqual({ readerId: 'kid-2', name: 'Kid Two', avatar: '🐢', at: '2026-03-05T10:00:00.000Z' });
    const kidOnes = familyPart(input({ item: { isbn: ISBN, step: 17, readerId: 'kid-1', firstReadAt: '2026-03-02T10:00:00.000Z' } }));
    expect(kidOnes.first).toEqual({ readerId: 'kid-1', name: 'Kid One', avatar: '🦊', at: '2026-03-02T10:00:00.000Z' });
    expect(kidOnes.step).toBe(17);
  });

  it('lists every reader’s counts whichever pile book it is, the earliest reader first (ties by reader id)', () => {
    const same = '2026-03-02T10:00:00.000Z';
    const f = familyPart(input({ summaries: [summary('kid-2', ISBN, same, 1), summary('kid-1', ISBN, same, 1)] }));
    expect(f.reads.map((r) => r.readerId)).toEqual(['kid-1', 'kid-2']);
    expect(f.first.readerId).toBe('kid-2');
  });

  it('keeps the stack item’s number', () => {
    expect(familyPart(input()).step).toBe(42);
  });

  it('counts each reader’s confirmed reads, first reader first, and the total', () => {
    const f = familyPart(input());
    expect(f.reads.map((r) => [r.name, r.count])).toEqual([
      ['Kid One', 3],
      ['Kid Two', 1],
    ]);
    expect(f.total).toBe(4);
  });

  it('no summaries for the book (or a reader who has gone)', () => {
    expect(familyPart(input({ summaries: [] }))).toMatchObject({ first: { readerId: 'kid-2' }, reads: [], total: 0 });
    const gone = familyPart(input({ readers: [] }));
    expect(gone.first).toMatchObject({ name: 'Someone', avatar: '📖' });
  });

  it('a home book', () => {
    expect(familyPart(input({ homeIsbns: new Set([ISBN]) })).home).toBe(true);
    expect(familyPart(input({ homeIsbns: new Set([OTHER]) })).home).toBe(false);
  });

  it('shows a loan only while it’s out, with the library, who borrowed it and when it’s due', () => {
    const loans = [
      loan('l1', 'kid-2', ISBN, { library_id: 'lib-1' }),
      loan('l2', 'kid-1', ISBN, { returned_at: '2026-11-10T00:00:00.000Z' }),
      loan('l3', 'kid-1', OTHER),
    ];
    expect(familyPart(input({ loans })).loans).toEqual([
      { library: 'Pretend Library', borrower: { readerId: 'kid-2', name: 'Kid Two', avatar: '🐢' }, due: '2026-11-29' },
    ]);
    expect(familyPart(input({ loans: [loans[1]] })).loans).toEqual([]);
  });

  it('a loan from a library that’s gone keeps its own name; one with none has no name; soonest due first', () => {
    const loans = [
      loan('a', 'kid-1', ISBN, { library_id: 'deleted', library_name: 'Old Library', due_date: '2026-12-20' }),
      loan('b', 'kid-2', ISBN, { due_date: null }),
      loan('c', 'grown-1', ISBN, { due_date: '2026-12-01' }),
    ];
    expect(familyPart(input({ loans })).loans.map((l) => [l.borrower.readerId, l.library, l.due])).toEqual([
      ['grown-1', null, '2026-12-01'],
      ['kid-1', 'Old Library', '2026-12-20'],
      ['kid-2', null, null],
    ]);
  });

  it('its collection and number, if it has one', () => {
    expect(familyPart(input({ book: { collection_id: 'set-1', volume: 3 } })).collection).toEqual({ title: 'Moon Stories', volume: 3 });
    expect(familyPart(input({ book: { collection_id: 'set-1', volume: null } })).collection).toEqual({ title: 'Moon Stories', volume: null });
    expect(familyPart(input({ book: { collection_id: 'gone', volume: 1 } })).collection).toBeNull();
    expect(familyPart(input({ book: undefined })).collection).toBeNull();
  });
});
