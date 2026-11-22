import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_PIN_ATTEMPTS,
  PIN_ATTEMPTS_KEY,
  afterWrongPin,
  formatWait,
  parsePinAttempts,
  pinTriesLeft,
  pinWaitLeft,
  pinWaitMs,
  readPinAttempts,
  writePinAttempts,
  type PinAttempts,
} from '../pinAttempts';
import { isAppStorageKey } from '../helpers';

// Wrong household-PIN tries (src/grownups/pinAttempts.ts).

const T0 = 1_800_000_000_000;
const S = 1000;
const MIN = 60 * S;

/** Wrong PINs one after another, each as soon as allowed; the waits each one started. */
function wrongInARow(count: number) {
  let a: PinAttempts = NO_PIN_ATTEMPTS;
  let now = T0;
  const waits: number[] = [];
  for (let i = 0; i < count; i++) {
    now = Math.max(now, a.lockedUntil ?? now);
    a = afterWrongPin(a, now);
    waits.push(pinWaitLeft(a, now));
  }
  return { attempts: a, waits };
}

/** A localStorage for the node tests. */
function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('wrong PINs', () => {
  it('4 are free; the 5th waits 30 s; each further one doubles, up to 15 minutes', () => {
    expect(wrongInARow(12).waits).toEqual([0, 0, 0, 0, 30 * S, 1 * MIN, 2 * MIN, 4 * MIN, 8 * MIN, 15 * MIN, 15 * MIN, 15 * MIN]);
    expect(pinWaitMs(1000)).toBe(15 * MIN);
  });

  it('says how many tries are left before a wait', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => pinTriesLeft(wrongInARow(n).attempts))).toEqual([4, 3, 2, 1, 0, 0]);
  });

  it('the wait counts down and ends', () => {
    const a = afterWrongPin(wrongInARow(4).attempts, T0);
    expect(pinWaitLeft(a, T0)).toBe(30 * S);
    expect(pinWaitLeft(a, T0 + 29 * S)).toBe(1 * S);
    expect(pinWaitLeft(a, T0 + 30 * S)).toBe(0);
  });

  it('formats waits as m:ss', () => {
    expect([30 * S, 61 * S, 15 * MIN, 1].map(formatWait)).toEqual(['0:30', '1:01', '15:00', '0:01']);
  });
});

describe('stored on this device', () => {
  it('survives a reload: the wait and the count come back', () => {
    const { attempts } = wrongInARow(6); // waiting 1 minute
    const raw = JSON.stringify(attempts);
    const now = attempts.lockedUntil! - 20 * S;
    expect(parsePinAttempts(raw, now)).toEqual(attempts);
    expect(pinWaitLeft(parsePinAttempts(raw, now), now)).toBe(20 * S);
  });

  it('after a wait ends the count stays, so the next wrong PIN waits longer', () => {
    const { attempts } = wrongInARow(5); // waiting 30 s
    const later = attempts.lockedUntil! + 1;
    const reloaded = parsePinAttempts(JSON.stringify(attempts), later);
    expect(reloaded).toEqual({ wrong: 5, lockedUntil: null });
    expect(pinWaitLeft(afterWrongPin(reloaded, later), later)).toBe(1 * MIN);
  });

  it('a stored wait can’t be longer than 15 minutes (clock set back), and junk is ignored', () => {
    expect(parsePinAttempts(JSON.stringify({ wrong: 9, lockedUntil: T0 + 999 * MIN }), T0).lockedUntil).toBe(T0 + 15 * MIN);
    for (const junk of [null, '', 'nope', '{"wrong":-1}', '{"wrong":"x"}', '[]']) {
      expect(parsePinAttempts(junk, T0)).toEqual(NO_PIN_ATTEMPTS);
    }
  });

  it('is written to localStorage, and a right PIN clears it', () => {
    const data = stubStorage();
    const { attempts } = wrongInARow(5);
    writePinAttempts(attempts);
    expect(data.has(PIN_ATTEMPTS_KEY)).toBe(true);
    expect(readPinAttempts(T0)).toEqual(attempts);
    writePinAttempts(NO_PIN_ATTEMPTS);
    expect(data.has(PIN_ATTEMPTS_KEY)).toBe(false);
    expect(readPinAttempts(T0)).toEqual(NO_PIN_ATTEMPTS);
  });

  it('"Reset this device" clears it (an app storage key)', () => {
    expect(isAppStorageKey(PIN_ATTEMPTS_KEY)).toBe(true);
  });
});
