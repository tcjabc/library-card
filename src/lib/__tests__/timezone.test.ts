import { afterEach, describe, expect, it, vi } from 'vitest';
import { dueStatus } from '../../library/due';
import { checkLoanDates, dateToTimestamp, timestampToDate } from '../../library/loans';
import { setPretendToday, todayLocal } from '../clock';
import {
  calendarDateIn,
  currentTimeZone,
  deviceTimeZone,
  isTimeZone,
  listTimeZones,
  noonIn,
  onTimeZoneChange,
  setHouseholdTimeZone,
} from '../timezone';

// The household's time zone (src/lib/timezone.ts) and every "today" that follows it.
// The test device is in America/New_York (vitest.config.ts).

afterEach(() => {
  setHouseholdTimeZone(null);
  setPretendToday(null);
});

/** 00:30 on 23 November in Taipei; still 22 November in New York, London and Samoa. */
const NEAR_MIDNIGHT = new Date('2026-11-22T16:30:00Z');

describe('zones', () => {
  it('the device zone is the test zone, and valid', () => {
    expect(deviceTimeZone()).toBe('America/New_York');
    expect(isTimeZone(deviceTimeZone())).toBe(true);
  });

  it('isTimeZone accepts IANA names only', () => {
    expect(isTimeZone('Asia/Taipei')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(null)).toBe(false);
    expect(isTimeZone(8)).toBe(false);
    expect(isTimeZone('x'.repeat(100))).toBe(false);
  });

  it('listTimeZones lists real zones, the device zone among them', () => {
    const zones = listTimeZones();
    expect(zones).toContain('Asia/Taipei');
    expect(zones).toContain(deviceTimeZone());
    expect(zones.every(isTimeZone)).toBe(true);
  });
});

describe('calendarDateIn', () => {
  it.each([
    ['Asia/Taipei', '2026-11-23'],
    ['Pacific/Kiritimati', '2026-11-23'], // UTC+14
    ['Europe/London', '2026-11-22'],
    ['UTC', '2026-11-22'],
    ['America/New_York', '2026-11-22'],
    ['Pacific/Pago_Pago', '2026-11-22'], // UTC-11
  ])('in %s the instant is %s', (zone, date) => {
    expect(calendarDateIn(NEAR_MIDNIGHT, zone)).toBe(date);
  });

  it('follows daylight saving', () => {
    // New York springs forward at 02:00 on 8 March 2026 (07:00Z).
    expect(calendarDateIn(new Date('2026-03-08T04:59:00Z'), 'America/New_York')).toBe('2026-03-07');
    expect(calendarDateIn(new Date('2026-03-08T05:00:00Z'), 'America/New_York')).toBe('2026-03-08');
    expect(calendarDateIn(new Date('2026-03-09T03:59:00Z'), 'America/New_York')).toBe('2026-03-08');
    expect(calendarDateIn(new Date('2026-03-09T04:00:00Z'), 'America/New_York')).toBe('2026-03-09');
  });
});

describe('noonIn', () => {
  it.each([
    ['2026-11-23', 'Asia/Taipei', '2026-11-23T04:00:00.000Z'],
    ['2026-11-23', 'UTC', '2026-11-23T12:00:00.000Z'],
    ['2026-11-23', 'Pacific/Kiritimati', '2026-11-22T22:00:00.000Z'],
    ['2026-11-23', 'Pacific/Pago_Pago', '2026-11-23T23:00:00.000Z'],
    ['2026-03-07', 'America/New_York', '2026-03-07T17:00:00.000Z'], // EST
    ['2026-03-08', 'America/New_York', '2026-03-08T16:00:00.000Z'], // EDT, the day it changes
  ])('noon on %s in %s is %s', (date, zone, iso) => {
    expect(noonIn(date, zone)).toBe(iso);
    expect(calendarDateIn(new Date(iso), zone)).toBe(date);
  });
});

describe('today in the household zone', () => {
  it('todayLocal uses the household zone, else the device zone', () => {
    expect(todayLocal(NEAR_MIDNIGHT)).toBe('2026-11-22');
    setHouseholdTimeZone('Asia/Taipei');
    expect(currentTimeZone()).toBe('Asia/Taipei');
    expect(todayLocal(NEAR_MIDNIGHT)).toBe('2026-11-23');
    setHouseholdTimeZone(null);
    expect(todayLocal(NEAR_MIDNIGHT)).toBe('2026-11-22');
  });

  it('an invalid zone is ignored (the device zone is used)', () => {
    setHouseholdTimeZone('Not/A_Zone');
    expect(currentTimeZone()).toBe('America/New_York');
  });

  it('the pretend date still wins (developer tools)', () => {
    const session = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => void session.set(k, v),
        removeItem: (k: string) => void session.delete(k),
      },
    });
    try {
      setHouseholdTimeZone('Asia/Taipei');
      setPretendToday('2027-01-01');
      expect(todayLocal(NEAR_MIDNIGHT)).toBe('2027-01-01');
      setPretendToday(null);
      expect(todayLocal(NEAR_MIDNIGHT)).toBe('2026-11-23');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tells listeners (useToday) when the zone changes, once per change', () => {
    const heard = vi.fn();
    const off = onTimeZoneChange(heard);
    setHouseholdTimeZone('Asia/Taipei');
    setHouseholdTimeZone('Asia/Taipei');
    setHouseholdTimeZone('Europe/London');
    off();
    setHouseholdTimeZone(null);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('two devices in different zones show the same due chip near midnight', () => {
    // A loan due 22 November, seen at 00:30 on the 23rd in Taipei (the household's zone).
    setHouseholdTimeZone('Asia/Taipei');
    const onEither = todayLocal(NEAR_MIDNIGHT); // the same on a device in New York and in Taipei
    expect(dueStatus('2026-11-22', onEither)).toBe('overdue');
    expect(dueStatus('2026-11-25', onEither)).toBe('soon');
    expect(dueStatus('2026-11-26', onEither)).toBe('later');
    // Without the household zone, the New York device would still say "due soon".
    setHouseholdTimeZone(null);
    expect(dueStatus('2026-11-22', todayLocal(NEAR_MIDNIGHT))).toBe('soon');
  });

  it('the loan editor’s "not in the future" check uses the household’s today', () => {
    setHouseholdTimeZone('Asia/Taipei');
    const today = todayLocal(NEAR_MIDNIGHT);
    expect(checkLoanDates({ borrowed: '2026-11-23', due: '2026-12-07', returned: null }, today).borrowed).toBeFalsy();
    expect(checkLoanDates({ borrowed: '2026-11-24', due: '2026-12-07', returned: null }, today).borrowed).toBeTruthy();
  });

  it('borrowed and returned dates convert in the household zone', () => {
    expect(timestampToDate('2026-11-22T16:30:00.000Z', 'Asia/Taipei')).toBe('2026-11-23');
    expect(timestampToDate('2026-11-22T16:30:00.000Z', 'America/New_York')).toBe('2026-11-22');
    setHouseholdTimeZone('Asia/Taipei');
    expect(timestampToDate('2026-11-22T16:30:00.000Z')).toBe('2026-11-23');
    // Unchanged date: the original instant stays; a new date is noon there.
    expect(dateToTimestamp('2026-11-23', '2026-11-22T16:30:00.000Z')).toBe('2026-11-22T16:30:00.000Z');
    expect(dateToTimestamp('2026-11-24', '2026-11-22T16:30:00.000Z')).toBe('2026-11-24T04:00:00.000Z');
  });
});
