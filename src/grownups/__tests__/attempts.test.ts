import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCKOUT_MS,
  MAX_STRIKES,
  NO_ATTEMPTS,
  afterWrongAnswer,
  isLockedOut,
  lockoutSecondsLeft,
  parseAttempts,
  readAttempts,
  writeAttempts,
} from '../attempts';

const NOW = Date.parse('2026-06-01T12:00:00Z');

describe('three strikes', () => {
  it('the first two wrong answers count, the third starts a 30-second wait', () => {
    const one = afterWrongAnswer(NO_ATTEMPTS, NOW);
    const two = afterWrongAnswer(one, NOW);
    const three = afterWrongAnswer(two, NOW);
    expect([one, two]).toEqual([
      { strikes: 1, lockedUntil: null },
      { strikes: 2, lockedUntil: null },
    ]);
    expect(three).toEqual({ strikes: MAX_STRIKES, lockedUntil: NOW + LOCKOUT_MS });
    expect(LOCKOUT_MS).toBe(30_000);
  });

  it('is locked until the wait ends, with a whole-second countdown', () => {
    const locked = { strikes: 3, lockedUntil: NOW + LOCKOUT_MS };
    expect(isLockedOut(locked, NOW)).toBe(true);
    expect(lockoutSecondsLeft(locked, NOW)).toBe(30);
    expect(lockoutSecondsLeft(locked, NOW + 29_001)).toBe(1); // rounds up
    expect(isLockedOut(locked, NOW + LOCKOUT_MS)).toBe(false);
    expect(lockoutSecondsLeft(locked, NOW + LOCKOUT_MS)).toBe(0);
    expect(isLockedOut(NO_ATTEMPTS, NOW)).toBe(false);
  });
});

describe('parseAttempts (what a reload sees)', () => {
  it('keeps a wait that has not ended', () => {
    expect(parseAttempts(JSON.stringify({ strikes: 3, lockedUntil: NOW + 5_000 }), NOW)).toEqual({ strikes: 3, lockedUntil: NOW + 5_000 });
  });

  it('starts over after a wait that has ended (regression: one more wrong answer used to lock again at once)', () => {
    const stored = JSON.stringify({ strikes: 3, lockedUntil: NOW - 1 });
    const parsed = parseAttempts(stored, NOW);
    expect(parsed).toEqual(NO_ATTEMPTS);
    expect(afterWrongAnswer(parsed, NOW).lockedUntil).toBeNull();
  });

  it('keeps strikes below the limit and ignores junk', () => {
    expect(parseAttempts(JSON.stringify({ strikes: 2, lockedUntil: null }), NOW)).toEqual({ strikes: 2, lockedUntil: null });
    expect(parseAttempts(JSON.stringify({ strikes: 7, lockedUntil: null }), NOW)).toEqual({ strikes: 2, lockedUntil: null });
    expect(parseAttempts(JSON.stringify({ strikes: -1 }), NOW)).toEqual(NO_ATTEMPTS);
    expect(parseAttempts('not json', NOW)).toEqual(NO_ATTEMPTS);
    expect(parseAttempts(null, NOW)).toEqual(NO_ATTEMPTS);
  });
});

describe('sessionStorage copy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips through sessionStorage and clears itself when reset', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => data.set(k, v),
        removeItem: (k: string) => data.delete(k),
      },
    });
    const locked = { strikes: 3, lockedUntil: NOW + LOCKOUT_MS };
    writeAttempts(locked);
    expect(readAttempts(NOW)).toEqual(locked);
    writeAttempts(NO_ATTEMPTS);
    expect(data.size).toBe(0);
  });

  it('copes with storage that throws (private browsing)', () => {
    const broken = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('window', { sessionStorage: { getItem: broken, setItem: broken, removeItem: broken } });
    expect(() => writeAttempts({ strikes: 1, lockedUntil: null })).not.toThrow();
    expect(readAttempts(NOW)).toEqual(NO_ATTEMPTS);
  });
});
