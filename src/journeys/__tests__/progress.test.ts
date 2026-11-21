import { describe, expect, it } from 'vitest';
import { booksToGo, filledSteps, isComplete, journeyProgress, type FirstRead } from '../progress';

const read = (isbn: string, first_read_at: string): FirstRead => ({ isbn, first_read_at });
const START = '2026-03-01T00:00:00.000Z';

describe('journeyProgress', () => {
  const reads = [
    read('A', '2026-02-20T00:00:00.000Z'), // before the start: never counts, even if re-read later
    read('B', '2026-03-01T00:00:00.000Z'), // exactly at the start: counts
    read('C', '2026-03-05T00:00:00.000Z'),
    read('D', '2026-03-04T00:00:00.000Z'),
  ];

  it('counts books first read at or after the start', () => {
    expect(journeyProgress(reads, START, 10)).toBe(3);
  });

  it('is capped at the journey length', () => {
    expect(journeyProgress(reads, START, 2)).toBe(2);
  });

  it('is 0 with nothing read', () => {
    expect(journeyProgress([], START, 5)).toBe(0);
  });
});

describe('isComplete and booksToGo', () => {
  it('complete when every step is filled', () => {
    expect([isComplete(4, 5), isComplete(5, 5), isComplete(6, 5), isComplete(0, 0)]).toEqual([false, true, true, false]);
    expect([booksToGo(3, 10), booksToGo(10, 10), booksToGo(12, 10)]).toEqual([7, 0, 0]);
  });
});

describe('filledSteps', () => {
  it('fills steps in first-read order, ties broken by isbn', () => {
    const reads = [
      read('Z', '2026-03-02T00:00:00.000Z'),
      read('M', '2026-03-03T00:00:00.000Z'),
      read('B', '2026-03-02T00:00:00.000Z'),
      read('old', '2026-01-01T00:00:00.000Z'),
    ];
    expect(filledSteps(reads, START, 10).map((s) => [s.step, s.isbn])).toEqual([
      [1, 'B'],
      [2, 'Z'],
      [3, 'M'],
    ]);
  });

  it('only the first `steps` books fill steps', () => {
    const reads = ['A', 'B', 'C'].map((isbn, i) => read(isbn, `2026-03-0${i + 2}T00:00:00.000Z`));
    expect(filledSteps(reads, START, 2).map((s) => s.isbn)).toEqual(['A', 'B']);
  });
});
