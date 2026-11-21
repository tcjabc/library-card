/**
 * Wrong-answer tracking for the ParentGate: three wrong answers in a row means
 * a 30-second wait. Pure functions plus a sessionStorage copy, so a reload
 * can't skip the wait.
 */

export const MAX_STRIKES = 3;
export const LOCKOUT_MS = 30_000;
const ATTEMPTS_KEY = 'library-card:gate-attempts';

export interface Attempts {
  /** Wrong answers in a row. */
  strikes: number;
  /** Epoch ms when the wait ends, or null when not waiting. */
  lockedUntil: number | null;
}

export const NO_ATTEMPTS: Attempts = Object.freeze({ strikes: 0, lockedUntil: null });

/** After one more wrong answer at `now`: the third in a row starts the wait. */
export function afterWrongAnswer(attempts: Attempts, now: number): Attempts {
  const strikes = attempts.strikes + 1;
  return strikes >= MAX_STRIKES ? { strikes, lockedUntil: now + LOCKOUT_MS } : { strikes, lockedUntil: null };
}

export function isLockedOut(attempts: Attempts, now: number): boolean {
  return attempts.lockedUntil !== null && attempts.lockedUntil > now;
}

/** Whole seconds left in the wait (rounded up), 0 when not waiting. */
export function lockoutSecondsLeft(attempts: Attempts, now: number): number {
  return isLockedOut(attempts, now) ? Math.ceil((attempts.lockedUntil! - now) / 1000) : 0;
}

/**
 * Attempts from their stored JSON. A wait that has ended clears everything;
 * anything unreadable counts as no attempts.
 */
export function parseAttempts(raw: string | null, now: number): Attempts {
  if (!raw) return NO_ATTEMPTS;
  try {
    const parsed = JSON.parse(raw) as Partial<Attempts>;
    const lockedUntil = typeof parsed.lockedUntil === 'number' && parsed.lockedUntil > now ? parsed.lockedUntil : null;
    if (lockedUntil) return { strikes: MAX_STRIKES, lockedUntil };
    // A finished wait starts over; otherwise keep the strike count.
    if (typeof parsed.lockedUntil === 'number') return NO_ATTEMPTS;
    const strikes = Number(parsed.strikes);
    return { strikes: Number.isInteger(strikes) && strikes > 0 ? Math.min(strikes, MAX_STRIKES - 1) : 0, lockedUntil: null };
  } catch {
    return NO_ATTEMPTS;
  }
}

export function readAttempts(now: number = Date.now()): Attempts {
  try {
    return parseAttempts(window.sessionStorage.getItem(ATTEMPTS_KEY), now);
  } catch {
    return NO_ATTEMPTS;
  }
}

export function writeAttempts(attempts: Attempts): void {
  try {
    if (attempts.strikes === 0 && attempts.lockedUntil === null) window.sessionStorage.removeItem(ATTEMPTS_KEY);
    else window.sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    // Storage blocked: attempts only last for this screen.
  }
}
