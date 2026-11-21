import { describe, expect, it } from 'vitest';
import { parseHashQuery } from '../../router';
import { isGrownUpPath } from '../session';

describe('isGrownUpPath', () => {
  it('covers the grown-up area and developer tools only', () => {
    expect(['/grownups', '/grownups/books', '/grownups/settings', '/dev'].map(isGrownUpPath)).toEqual([true, true, true, true]);
    expect(['/', '/hub', '/shelf', '/grownupsx', '/devices'].map(isGrownUpPath)).toEqual([false, false, false, false, false]);
  });
});

describe('parseHashQuery', () => {
  it('reads the query after the path', () => {
    expect(parseHashQuery('#/grownups/loans?reader=r1').get('reader')).toBe('r1');
    expect(parseHashQuery('#/grownups/cards?reader=a%20b&x=1').get('reader')).toBe('a b');
  });

  it('is empty without one', () => {
    expect([...parseHashQuery('#/hub').keys()]).toEqual([]);
    expect([...parseHashQuery('').keys()]).toEqual([]);
  });
});
