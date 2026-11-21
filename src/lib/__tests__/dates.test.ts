import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysUntil,
  isCalendarDate,
  parseCalendarDate,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toCalendarDate,
} from '../dates';

// vitest.config.ts runs the tests in America/New_York, which has daylight
// saving: clocks go forward on 2026-03-08 and back on 2026-11-01.

describe('time zone of the test run', () => {
  it('is America/New_York', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(300);
    expect(new Date('2026-07-15T12:00:00Z').getTimezoneOffset()).toBe(240);
  });
});

describe('calendar dates', () => {
  it('toCalendarDate uses the local day, not UTC', () => {
    // 02:00 UTC on the 2nd is still 21:00 on the 1st in New York.
    expect(toCalendarDate(new Date('2026-02-02T02:00:00Z'))).toBe('2026-02-01');
  });

  it('isCalendarDate accepts real dates only', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true); // leap year
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
    expect(isCalendarDate('01/02/2026')).toBe(false);
  });

  it('parseCalendarDate gives local midnight and rejects bad input', () => {
    const d = parseCalendarDate('2026-03-08');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 8, 0]);
    expect(() => parseCalendarDate('2026-02-30')).toThrow(RangeError);
  });

  it('addDays counts calendar days, across DST, month and year ends', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // spring forward on the 8th
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02'); // fall back on the 1st
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-10', 21)).toBe('2026-01-31'); // default loan length
  });

  it('daysUntil counts whole local days', () => {
    const now = new Date('2026-03-07T23:30:00-05:00');
    expect(daysUntil('2026-03-07', now)).toBe(0);
    expect(daysUntil('2026-03-09', now)).toBe(2); // across the short DST day
    expect(daysUntil('2026-03-06', now)).toBe(-1);
  });
});

describe('local-time boundaries', () => {
  it('startOfLocalDay is local midnight as a UTC timestamp', () => {
    expect(startOfLocalDay(new Date('2026-01-15T18:00:00Z'))).toBe('2026-01-15T05:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-07-15T18:00:00Z'))).toBe('2026-07-15T04:00:00.000Z');
  });

  it('startOfLocalWeek starts on Monday by default, or Sunday', () => {
    const wednesday = new Date('2026-01-14T15:00:00Z');
    expect(startOfLocalWeek(wednesday)).toBe('2026-01-12T05:00:00.000Z');
    expect(startOfLocalWeek(wednesday, 0)).toBe('2026-01-11T05:00:00.000Z');
    const sunday = new Date('2026-01-18T15:00:00Z');
    expect(startOfLocalWeek(sunday)).toBe('2026-01-12T05:00:00.000Z');
    expect(startOfLocalWeek(sunday, 0)).toBe('2026-01-18T05:00:00.000Z');
  });

  it('startOfLocalMonth', () => {
    expect(startOfLocalMonth(new Date('2026-03-20T12:00:00Z'))).toBe('2026-03-01T05:00:00.000Z');
  });
});
