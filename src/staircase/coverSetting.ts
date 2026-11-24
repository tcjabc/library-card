import { useSyncExternalStore } from 'react';

/**
 * "Covers on the stack" (developer tools: the book stack page): real covers on the Family
 * Staircase's books, their colour on the spines and their picture on the top faces. On unless
 * switched off on this device (localStorage, cleared by "Reset this device"), for a device that
 * struggles to draw them.
 */

export const STACK_COVERS_KEY = 'library-card:stack-covers';

const listeners = new Set<() => void>();

export function readStackCovers(): boolean {
  try {
    return window.localStorage.getItem(STACK_COVERS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeStackCovers(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(STACK_COVERS_KEY);
    else window.localStorage.setItem(STACK_COVERS_KEY, 'off');
  } catch {
    // No storage: the choice lasts until the page closes.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STACK_COVERS_KEY || event.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useStackCovers(): boolean {
  return useSyncExternalStore(subscribe, readStackCovers, () => true);
}
