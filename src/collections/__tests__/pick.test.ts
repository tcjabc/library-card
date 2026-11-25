import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Book, Collection } from '../../data';
import { fmt, strings } from '../../strings';
import { BookPicker } from '../BookPicker';
import { expectedText, moveConfirmTitle, pickCandidates, pickEntries, PICK_ROWS_SHOWN, pickSummary, shownCandidates, togglePick } from '../pick';

// Picking existing books for a new set (src/collections/pick.ts, BookPicker.tsx). Tests run in
// Node (no DOM), so the picker is checked as rendered markup for given ticks and search text.

const t = strings.collections;

const book = (isbn: string, title: string, collection_id: string | null = null, authors: string[] = []): Book => ({
  isbn,
  title,
  authors,
  cover_url: null,
  source: 'manual',
  collection_id,
  volume: null,
});
const set = (id: string, title: string): Collection => ({ id, household_id: 'main', title, cover_url: null, isbn: null, expected_count: null });

const books = [
  book('9780000000002', 'Owl Babies', null, ['Martin Waddell']),
  book('9780000000019', 'Gruffalo', 'set-1'),
  book('9780000000026', 'Library Dragon'),
  book('noisbn-gone', 'Stale member', 'deleted-set'),
];
const home = new Set(['9780000000002', '9780000000019', 'noisbn-gone']);
const candidates = pickCandidates(books, home, [set('set-1', 'Julia’s box')]);

const render = (props: Partial<Parameters<typeof BookPicker>[0]> = {}) =>
  renderToStaticMarkup(createElement(BookPicker, { candidates, picked: [], numbered: true, onToggle: () => {}, ...props }));

describe('the books to pick from', () => {
  it('Home and borrowed books once each, by title; which set each is in now (a deleted set: none)', () => {
    const twice = pickCandidates([...books, books[0]], home, [set('set-1', 'Julia’s box')]);
    expect(twice.map((c) => [c.book.title, c.atHome, c.fromSet?.title ?? null])).toEqual([
      ['Gruffalo', true, 'Julia’s box'],
      ['Library Dragon', false, null],
      ['Owl Babies', true, null],
      ['Stale member', true, null],
    ]);
  });

  it("leaves out the set's own books", () => {
    expect(pickCandidates(books, home, [set('set-1', 'Box')], 'set-1').map((c) => c.book.title)).not.toContain('Gruffalo');
  });
});

describe('ticking, numbering and the count', () => {
  it('keeps the tick order; unticking closes the gap', () => {
    let picked = togglePick([], 'b');
    picked = togglePick(picked, 'a');
    picked = togglePick(picked, 'c');
    expect(picked).toEqual(['b', 'a', 'c']);
    expect(togglePick(picked, 'a')).toEqual(['b', 'c']);
  });

  it('numbers 1…N in tick order when on, no numbers when off', () => {
    expect(pickEntries(['b', 'a'], true)).toEqual([
      { isbn: 'b', volume: 1 },
      { isbn: 'a', volume: 2 },
    ]);
    expect(pickEntries(['b', 'a'], false)).toEqual([
      { isbn: 'b', volume: null },
      { isbn: 'a', volume: null },
    ]);
  });

  it('"How many books" follows the number ticked until typed in; emptied stays empty (no trophy)', () => {
    expect(expectedText(null, 0)).toBe('');
    expect(expectedText(null, 3)).toBe('3');
    expect(expectedText('5', 3)).toBe('5');
    expect(expectedText('', 3)).toBe('');
  });
});

describe('what saving does: moves and borrowed books', () => {
  it('counts the ticked books that move or are borrowed', () => {
    expect(pickSummary(['9780000000019', '9780000000026', 'not-there'], candidates)).toEqual({ count: 2, moving: 1, borrowed: 1 });
  });

  it('one confirm only when books move from other sets', () => {
    expect(moveConfirmTitle({ count: 2, moving: 0, borrowed: 1 })).toBeNull();
    expect(moveConfirmTitle({ count: 2, moving: 1, borrowed: 0 })).toBe(t.moveTitleOne);
    expect(moveConfirmTitle({ count: 4, moving: 3, borrowed: 0 })).toBe(fmt(t.moveTitle, { count: 3 }));
  });
});

describe('search and the row cap', () => {
  const many = pickCandidates(
    Array.from({ length: 120 }, (_, i) => book(`noisbn-${String(i).padStart(3, '0')}`, `Book ${String(i).padStart(3, '0')}`)),
    new Set(),
    [],
  );

  it(`shows at most ${PICK_ROWS_SHOWN} rows, with how many matched`, () => {
    const { rows, matched } = shownCandidates(many, '');
    expect([rows.length, matched]).toEqual([PICK_ROWS_SHOWN, 120]);
    expect(shownCandidates(many, 'book 11')).toMatchObject({ matched: 11 }); // 011, 110–119
    expect(shownCandidates(candidates, 'waddell').rows.map((c) => c.book.title)).toEqual(['Owl Babies']);
  });

  it('says "keep typing" past the cap, not below it', () => {
    const big = renderToStaticMarkup(createElement(BookPicker, { candidates: many, picked: [], numbered: true, onToggle: () => {} }));
    expect(big).toContain(fmt(t.pickMore, { shown: PICK_ROWS_SHOWN, count: 120 }));
    expect((big.match(/type="checkbox"/g) ?? []).length).toBe(PICK_ROWS_SHOWN);
    expect(render()).not.toContain('Keep typing');
  });

  it('a search with no match says so', () => {
    expect(render({ initialSearch: 'zebra' })).toContain(fmt(t.pickNoMatch, { query: 'zebra' }));
  });
});

describe('the picker rows', () => {
  it('tags borrowed books and books in another set ("moves from …")', () => {
    const html = render();
    expect(html).toContain(t.borrowedTag);
    expect(html).toContain(fmt(t.movesFrom, { title: 'Julia’s box' }));
    expect((html.match(/chip-tag--warn/g) ?? []).length).toBe(1); // not for a book whose set is gone
  });

  it('shows "N selected" and, numbering on, each ticked book\'s number in tick order', () => {
    const html = render({ picked: ['9780000000026', '9780000000002'] });
    expect(html).toContain(fmt(t.pickSelected, { count: 2 }));
    // Rows are by title: Gruffalo, Library Dragon (ticked 1st), Owl Babies (ticked 2nd), Stale member.
    const numbers = [...html.matchAll(/class="set-sheet__number" aria-label="([^"]+)">(\d+)</g)].map((m) => [m[1], m[2]]);
    expect(numbers).toEqual([
      [fmt(t.volume, { volume: 1 }), '1'],
      [fmt(t.volume, { volume: 2 }), '2'],
    ]);
    expect((html.match(/checked=""/g) ?? []).length).toBe(2);
  });

  it('numbering off: ticked, but no numbers', () => {
    const html = render({ picked: ['9780000000026'], numbered: false });
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    expect(html).not.toContain('set-sheet__number');
  });

  it('the borrowed note shows only with a borrowed book ticked', () => {
    expect(render({ picked: ['9780000000002'] })).not.toContain(t.pickBorrowedNote);
    expect(render({ picked: ['9780000000026'] })).toContain(t.pickBorrowedNote);
  });

  it('loading, and no books at all', () => {
    expect(render({ candidates: null })).toContain(strings.common.loading);
    expect(render({ candidates: [] })).toContain(t.pickNone);
  });
});
