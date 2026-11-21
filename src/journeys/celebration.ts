import { useCallback, useSyncExternalStore } from 'react';

/**
 * "Pending celebration" flags: set when a reader finishes a journey, cleared
 * when they dismiss the celebration. One per reader, holding the journey id,
 * in localStorage so a celebration missed (tab closed, other device tab)
 * still shows next time. Every access is wrapped: storage can throw (private
 * mode, blocked site data, or no window in tests), and we then keep the flag
 * in memory for this page.
 */

const PREFIX = 'library-card:celebrate:';
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

const keyFor = (readerId: string) => `${PREFIX}${readerId}`;

export function getPendingCelebration(readerId: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(readerId));
  } catch {
    return memory.get(readerId) ?? null;
  }
}

function write(readerId: string, journeyId: string | null): void {
  if (journeyId === null) memory.delete(readerId);
  else memory.set(readerId, journeyId);
  try {
    if (journeyId === null) window.localStorage.removeItem(keyFor(readerId));
    else window.localStorage.setItem(keyFor(readerId), journeyId);
  } catch {
    // Keep the in-memory value.
  }
  listeners.forEach((l) => l());
}

export function setPendingCelebration(readerId: string, journeyId: string): void {
  write(readerId, journeyId);
}

export function clearPendingCelebration(readerId: string): void {
  write(readerId, null);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The journey id waiting to be celebrated for this reader, or null. */
export function usePendingCelebration(readerId: string | null): string | null {
  const get = useCallback(() => (readerId ? getPendingCelebration(readerId) : null), [readerId]);
  return useSyncExternalStore(subscribe, get, () => null);
}
