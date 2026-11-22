import { describe, expect, it } from 'vitest';
import { READ_TAP_GUARD_MS, type ReadEvent } from '../DataStore';
import { addToSummary, isRepeatTap, latestEvent, summarize } from '../readRules';

const at = (iso: string) => Date.parse(iso);
const event = (id: string, read_at: string, status: ReadEvent['status'] = 'confirmed'): ReadEvent => ({
  id,
  household_id: 'main',
  reader_id: 'r',
  isbn: 'b',
  read_at,
  how: null,
  status,
  confirmed_at: null,
  confirmed_by: null,
});

describe('isRepeatTap (double-tap guard)', () => {
  const last = '2026-05-01T10:00:00.000Z';

  it('is 10 seconds', () => {
    expect(READ_TAP_GUARD_MS).toBe(10_000);
  });

  it('ignores a tap inside the window and allows one at or after it', () => {
    expect(isRepeatTap(last, at(last) + 3_000)).toBe(true);
    expect(isRepeatTap(last, at(last) + 9_999)).toBe(true);
    expect(isRepeatTap(last, at(last) + 10_000)).toBe(false);
    expect(isRepeatTap(last, at(last) + 60_000)).toBe(false);
  });

  it('also counts a latest read stamped slightly in the future (clock skew)', () => {
    expect(isRepeatTap(last, at(last) - 5_000)).toBe(true);
    expect(isRepeatTap(last, at(last) - 15_000)).toBe(false);
  });

  it('never blocks when there is no earlier read or it is unreadable', () => {
    expect(isRepeatTap(null, at(last))).toBe(false);
    expect(isRepeatTap(undefined, at(last))).toBe(false);
    expect(isRepeatTap('not a date', at(last))).toBe(false);
  });

  it('takes a custom window', () => {
    expect(isRepeatTap(last, at(last) + 3_000, 1_000)).toBe(false);
  });
});

describe('latestEvent', () => {
  it('is the latest read_at, then the larger id', () => {
    const early = event('z', '2026-01-01T00:00:00.000Z');
    const late = event('a', '2026-02-01T00:00:00.000Z');
    const tieLow = event('b', '2026-03-01T00:00:00.000Z');
    const tieHigh = event('c', '2026-03-01T00:00:00.000Z');
    expect(latestEvent([early, late])).toBe(late);
    expect(latestEvent([tieHigh, early, tieLow])).toBe(tieHigh);
    expect(latestEvent([])).toBeNull();
  });
});

describe('summaries', () => {
  it('addToSummary tracks first, last and count in any order', () => {
    const s1 = addToSummary(null, event('1', '2026-03-10T00:00:00.000Z'));
    const s2 = addToSummary(s1, event('2', '2026-01-10T00:00:00.000Z'));
    const s3 = addToSummary(s2, event('3', '2026-04-10T00:00:00.000Z'));
    expect(s3).toEqual({
      reader_id: 'r',
      isbn: 'b',
      household_id: 'main',
      first_read_at: '2026-01-10T00:00:00.000Z',
      last_read_at: '2026-04-10T00:00:00.000Z',
      count: 3,
    });
  });

  it('summarize builds the same from a list, and null from none', () => {
    const events = [event('1', '2026-03-10T00:00:00.000Z'), event('2', '2026-01-10T00:00:00.000Z')];
    expect(summarize(events)).toMatchObject({ count: 2, first_read_at: '2026-01-10T00:00:00.000Z', last_read_at: '2026-03-10T00:00:00.000Z' });
    expect(summarize([])).toBeNull();
  });
});
