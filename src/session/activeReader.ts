import { useCallback, useSyncExternalStore } from 'react';
import { useDataQuery, type DataStore, type Reader } from '../data';

/**
 * The reader using this device right now, chosen by scanning their card.
 * Stored per device in localStorage. Every access is wrapped because storage
 * can throw (Safari private mode, blocked site data); we then fall back to
 * memory for this page.
 */

const KEY = 'library-card:active-reader';
let memoryValue: string | null = null;
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryValue;
  }
}

function write(value: string | null): void {
  memoryValue = value;
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // Keep the in-memory value.
  }
  listeners.forEach((l) => l());
}

export function getActiveReaderId(): string | null {
  return read();
}

export function setActiveReaderId(id: string): void {
  write(id);
}

export function clearActiveReader(): void {
  write(null);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useActiveReaderId(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/**
 * The active Reader record. `reader` is null when nobody is signed in or the
 * stored id no longer exists (e.g. the reader was deleted).
 */
export function useActiveReader(): { reader: Reader | null; loading: boolean } {
  const id = useActiveReaderId();
  const query = useCallback((s: DataStore) => (id ? s.getReader(id) : Promise.resolve(null)), [id]);
  const { data, loading } = useDataQuery(query, ['readers']);
  return { reader: data ?? null, loading: id !== null && loading };
}
