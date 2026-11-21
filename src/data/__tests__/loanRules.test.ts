import { describe, expect, it } from 'vitest';
import type { Loan } from '../DataStore';
import { findStickerDuplicates, pickStickerWinner, stickerKey } from '../loanRules';

const loan = (id: string, borrowed_at: string, extra: Partial<Loan> = {}): Loan => ({
  id,
  household_id: 'main',
  reader_id: 'r',
  isbn: '9780000000002',
  library_id: 'lib',
  library_name: null,
  sticker_barcode: '31000123',
  borrowed_at,
  due_date: null,
  returned_at: null,
  renew_count: 0,
  ...extra,
});

describe('pickStickerWinner', () => {
  it('picks the earliest borrowed_at, then the smallest id; the rest are duplicates', () => {
    const late = loan('a', '2026-02-01T00:00:00.000Z');
    const earlyB = loan('b', '2026-01-01T00:00:00.000Z');
    const earlyA = loan('a2', '2026-01-01T00:00:00.000Z');
    const result = pickStickerWinner([late, earlyB, earlyA]);
    expect(result?.winner.id).toBe('a2');
    expect(result?.duplicates.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('a single loan wins alone; none gives null', () => {
    const only = loan('x', '2026-01-01T00:00:00.000Z');
    expect(pickStickerWinner([only])).toEqual({ winner: only, duplicates: [] });
    expect(pickStickerWinner([])).toBeNull();
  });

  it('does not change the input order', () => {
    const list = [loan('b', '2026-02-01T00:00:00.000Z'), loan('a', '2026-01-01T00:00:00.000Z')];
    pickStickerWinner(list);
    expect(list.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('findStickerDuplicates', () => {
  it('groups active loans by library + sticker and maps each duplicate to its winner', () => {
    const winner = loan('w', '2026-01-01T00:00:00.000Z');
    const dup = loan('d', '2026-01-05T00:00:00.000Z');
    const otherLibrary = loan('o', '2026-01-03T00:00:00.000Z', { library_id: 'lib2' });
    const returned = loan('r', '2025-12-01T00:00:00.000Z', { returned_at: '2026-01-02T00:00:00.000Z' });
    const noSticker = loan('n', '2026-01-04T00:00:00.000Z', { sticker_barcode: null });
    const result = findStickerDuplicates([dup, winner, otherLibrary, returned, noSticker]);
    expect([...result.entries()]).toEqual([['d', 'w']]);
  });

  it('treats loans without a library as one group per sticker', () => {
    const a = loan('a', '2026-01-01T00:00:00.000Z', { library_id: null });
    const b = loan('b', '2026-01-02T00:00:00.000Z', { library_id: null });
    expect([...findStickerDuplicates([a, b]).entries()]).toEqual([['b', 'a']]);
  });
});

describe('stickerKey', () => {
  it('is null for returned loans and loans without a sticker', () => {
    expect(stickerKey(loan('a', 'x'))).toBe('lib\u000031000123');
    expect(stickerKey(loan('a', 'x', { returned_at: 'y' }))).toBeNull();
    expect(stickerKey(loan('a', 'x', { sticker_barcode: '' }))).toBeNull();
  });
});
