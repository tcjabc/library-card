import { useState } from 'react';

/**
 * A screen's Grid / List choice, remembered on this device (localStorage; keys start with
 * library-card: so "Reset this device" clears them). Only a choice that differs from the screen's
 * default is stored; the default when unset or when storage is unavailable.
 */

export type ViewChoice = 'grid' | 'list';

export function readViewChoice(key: string, fallback: ViewChoice): ViewChoice {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === 'grid' || stored === 'list' ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function writeViewChoice(key: string, view: ViewChoice, fallback: ViewChoice): void {
  try {
    if (view === fallback) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, view);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** The choice for `key` (read again when the key changes, e.g. another reader) and a setter that remembers it. */
export function useViewChoice(key: string, fallback: ViewChoice): [ViewChoice, (view: ViewChoice) => void] {
  const [state, setState] = useState(() => ({ key, view: readViewChoice(key, fallback) }));
  const view = state.key === key ? state.view : readViewChoice(key, fallback);
  const choose = (next: ViewChoice) => {
    setState({ key, view: next });
    writeViewChoice(key, next, fallback);
  };
  return [view, choose];
}
