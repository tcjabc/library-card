import { useSyncExternalStore } from 'react';
import { DECOR_LEVELS, type Decor } from './drawBudget';

/**
 * The decor level (clouds) for this device only: full, reduced or none, full unless chosen
 * otherwise (localStorage `library-card:stack-decor`, cleared by "Reset this device" with the
 * app's other `library-card:` keys). In 1.16.0 only the developer tools' book stack page sets it.
 * What's drawn is at most this: slow frames (per visit) and reduced motion can lower it
 * (drawBudget.decorInEffect). Followed live, also from another tab.
 */

export const STACK_DECOR_KEY = 'library-card:stack-decor';
export const DEFAULT_DECOR: Decor = 'full';

/** A stored value as a decor level (anything else: the default). */
export function parseDecor(value: string | null): Decor {
  return (DECOR_LEVELS as readonly string[]).includes(value ?? '') ? (value as Decor) : DEFAULT_DECOR;
}

const listeners = new Set<() => void>();

export function readStackDecor(): Decor {
  try {
    return parseDecor(window.localStorage.getItem(STACK_DECOR_KEY));
  } catch {
    return DEFAULT_DECOR;
  }
}

export function writeStackDecor(decor: Decor): void {
  try {
    if (decor === DEFAULT_DECOR) window.localStorage.removeItem(STACK_DECOR_KEY);
    else window.localStorage.setItem(STACK_DECOR_KEY, decor);
  } catch {
    // No storage: the choice lasts until the page closes.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STACK_DECOR_KEY || event.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** The current setting, re-rendering when it changes. */
export function useStackDecor(): Decor {
  return useSyncExternalStore(subscribe, readStackDecor, () => DEFAULT_DECOR);
}
