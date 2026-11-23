import { useSyncExternalStore } from 'react';

/**
 * Grown-up session: unlocked by passing the ParentGate.
 *
 * - Lives in sessionStorage (this tab only), as an expiry time. A reload
 *   within the window keeps access; once it has passed, a reload shows the
 *   gate again (the stored time is checked, never trusted blindly).
 * - Each tap or key press while unlocked pushes the expiry out, so it ends
 *   after IDLE_MS of inactivity.
 * - Leaving the grown-up area ends it (see App's route watcher).
 * - Expiry is re-checked when the page becomes visible again, because phones
 *   pause timers while asleep.
 */

export const GROWN_UP_IDLE_MS = 5 * 60 * 1000;
const KEY = 'library-card:grown-up-session';
// Don't rewrite storage on every tap.
const TOUCH_THROTTLE_MS = 5000;

let memoryExpiry: number | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function readExpiry(): number | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return memoryExpiry;
  }
}

function writeExpiry(value: number | null): void {
  memoryExpiry = value;
  try {
    if (value === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, String(value));
  } catch {
    // Fall back to memory for this page.
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

function schedule(): void {
  clearTimeout(expiryTimer);
  const expiry = readExpiry();
  if (expiry === null) return;
  expiryTimer = setTimeout(() => {
    if (!isGrownUpUnlocked()) {
      writeExpiry(null);
      notify();
    } else {
      schedule();
    }
  }, Math.max(0, expiry - Date.now()) + 50);
}

export function isGrownUpUnlocked(): boolean {
  const expiry = readExpiry();
  return expiry !== null && expiry > Date.now();
}

export function unlockGrownUp(): void {
  writeExpiry(Date.now() + GROWN_UP_IDLE_MS);
  // A new grown-up session: a PIN entered in an earlier one doesn't carry over.
  writePinUnlock(null);
  schedule();
  notify();
}

export function endGrownUpSession(): void {
  const wasSet = readExpiry() !== null;
  writeExpiry(null);
  writePinUnlock(null);
  clearTimeout(expiryTimer);
  if (wasSet) notify();
}

/* --------------------------------------------------------------------------
   Household PIN: a right PIN unlocks the PIN-guarded actions (pinPolicy.ts) for
   PIN_UNLOCK_MS, within the current grown-up session only, so a confirm flow
   doesn't ask twice. Leaving Grown-ups, or the session ending, locks them again.
   -------------------------------------------------------------------------- */

export const PIN_UNLOCK_MS = 2 * 60 * 1000;
const PIN_KEY = 'library-card:pin-unlocked';

/** Until when, and for which PIN (the end of its stored hash): a different PIN isn't unlocked. */
interface PinUnlock {
  until: number;
  pin: string;
}
let memoryPin: PinUnlock | null = null;

/** Enough of the stored hash to tell PINs apart; the hash itself stays in the database. */
const pinTag = (pinHash: string) => pinHash.slice(-12);

function readPinUnlock(): PinUnlock | null {
  try {
    const raw = window.sessionStorage.getItem(PIN_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<PinUnlock>;
    return typeof value.until === 'number' && typeof value.pin === 'string' ? { until: value.until, pin: value.pin } : null;
  } catch {
    return memoryPin;
  }
}

function writePinUnlock(value: PinUnlock | null): void {
  memoryPin = value;
  try {
    if (value === null) window.sessionStorage.removeItem(PIN_KEY);
    else window.sessionStorage.setItem(PIN_KEY, JSON.stringify(value));
  } catch {
    // Memory only for this page.
  }
}

/** The right PIN was just entered (or chosen): `pinHash` is the household's hash now. */
export function unlockPinActions(pinHash: string, now: number = Date.now()): void {
  writePinUnlock({ until: now + PIN_UNLOCK_MS, pin: pinTag(pinHash) });
}

/**
 * PIN-guarded actions run without asking: the household's current PIN (`pinHash`) was entered in
 * the last 2 minutes of this grown-up session. A PIN changed since (on another device, or by
 * joining a household) has to be entered again.
 */
export function isPinUnlocked(pinHash: string | null, now: number = Date.now()): boolean {
  const unlock = readPinUnlock();
  if (!pinHash || !unlock || !isGrownUpUnlocked()) return false;
  // Never longer than the window (a stored value can't be stretched).
  return unlock.pin === pinTag(pinHash) && unlock.until > now && unlock.until - now <= PIN_UNLOCK_MS;
}

/** Counts as activity: pushes the inactivity timeout out. No-op when locked. */
export function touchGrownUp(): void {
  if (!isGrownUpUnlocked()) return;
  const expiry = readExpiry() ?? 0;
  const next = Date.now() + GROWN_UP_IDLE_MS;
  if (next - expiry < TOUCH_THROTTLE_MS) return;
  writeExpiry(next);
  schedule();
}

const onActivity = () => touchGrownUp();
const onVisibility = () => {
  if (document.hidden) return;
  if (readExpiry() !== null && !isGrownUpUnlocked()) writeExpiry(null);
  schedule();
  notify();
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(expiryTimer);
    }
  };
}

export function useGrownUpUnlocked(): boolean {
  return useSyncExternalStore(subscribe, isGrownUpUnlocked, () => false);
}

/** Paths that make up the grown-up area. Leaving them ends the session. */
export function isGrownUpPath(path: string): boolean {
  return path === '/dev' || path.startsWith('/dev/') || path === '/grownups' || path.startsWith('/grownups/');
}
