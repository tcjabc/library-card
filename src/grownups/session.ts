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
  schedule();
  notify();
}

export function endGrownUpSession(): void {
  const wasSet = readExpiry() !== null;
  writeExpiry(null);
  clearTimeout(expiryTimer);
  if (wasSet) notify();
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
  return path === '/dev' || path === '/grownups' || path.startsWith('/grownups/');
}
