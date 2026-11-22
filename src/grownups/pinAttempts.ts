/**
 * Wrong household-PIN tries on this device: the first 4 wrong PINs cost nothing, the 5th
 * means a 30-second wait, and every wrong PIN after that doubles the wait, up to 15 minutes.
 * A right PIN starts over. Kept in localStorage, so a reload, a new tab or closing the app
 * doesn't skip a wait; "Reset this device" clears it (every library-card: key goes).
 * Pure functions plus the storage copy, so the rules are unit-tested.
 */

export const PIN_FREE_TRIES = 4;
export const PIN_FIRST_WAIT_MS = 30_000;
export const PIN_MAX_WAIT_MS = 15 * 60_000;
export const PIN_ATTEMPTS_KEY = 'library-card:pin-attempts';

export interface PinAttempts {
  /** Wrong PINs since the last right one. */
  wrong: number;
  /** Epoch ms when the current wait ends, or null when not waiting. */
  lockedUntil: number | null;
}

export const NO_PIN_ATTEMPTS: PinAttempts = Object.freeze({ wrong: 0, lockedUntil: null });

/** The wait after the `wrong`-th wrong PIN in a row (0 for the first four). */
export function pinWaitMs(wrong: number): number {
  if (wrong <= PIN_FREE_TRIES) return 0;
  // Capped before the power, so a huge count can't overflow.
  return Math.min(PIN_MAX_WAIT_MS, PIN_FIRST_WAIT_MS * 2 ** Math.min(wrong - PIN_FREE_TRIES - 1, 20));
}

export function afterWrongPin(attempts: PinAttempts, now: number): PinAttempts {
  const wrong = attempts.wrong + 1;
  const wait = pinWaitMs(wrong);
  return { wrong, lockedUntil: wait ? now + wait : null };
}

/** Milliseconds left in the current wait (0 when not waiting). */
export function pinWaitLeft(attempts: PinAttempts, now: number): number {
  return attempts.lockedUntil !== null && attempts.lockedUntil > now ? attempts.lockedUntil - now : 0;
}

/** Tries left before the first wait ("4 more tries"), or 0 once waits have started. */
export const pinTriesLeft = (attempts: PinAttempts): number => Math.max(0, PIN_FREE_TRIES + 1 - attempts.wrong);

/**
 * Attempts from their stored JSON. Unlike the gate, a finished wait keeps the count, so the
 * next wrong PIN waits twice as long. Anything unreadable counts as none. A wait can't be
 * longer than the longest one (a clock set back can't lock the device for days).
 */
export function parsePinAttempts(raw: string | null, now: number): PinAttempts {
  if (!raw) return NO_PIN_ATTEMPTS;
  try {
    const parsed = JSON.parse(raw) as Partial<PinAttempts>;
    const wrong = Number(parsed.wrong);
    if (!Number.isInteger(wrong) || wrong <= 0) return NO_PIN_ATTEMPTS;
    const until = typeof parsed.lockedUntil === 'number' ? Math.min(parsed.lockedUntil, now + PIN_MAX_WAIT_MS) : null;
    return { wrong, lockedUntil: until !== null && until > now ? until : null };
  } catch {
    return NO_PIN_ATTEMPTS;
  }
}

export function readPinAttempts(now: number = Date.now()): PinAttempts {
  try {
    return parsePinAttempts(window.localStorage.getItem(PIN_ATTEMPTS_KEY), now);
  } catch {
    return memory;
  }
}

let memory: PinAttempts = NO_PIN_ATTEMPTS;

export function writePinAttempts(attempts: PinAttempts): void {
  memory = attempts;
  try {
    if (attempts.wrong === 0) window.localStorage.removeItem(PIN_ATTEMPTS_KEY);
    else window.localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    // Storage blocked: the count lasts for this page.
  }
}

/** "0:30", "2:00", "15:00". */
export function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
