import { useSyncExternalStore } from 'react';

/**
 * An on/off choice for this device only (developer tools: the book stack page), on unless
 * switched off: localStorage `key` = "off", cleared by "Reset this device" with the app's other
 * `library-card:` keys. Followed live, also from another tab. With `defaultOn: false` it's off
 * unless switched on (`key` = "on").
 */
export interface DeviceSwitch {
  key: string;
  read(): boolean;
  write(on: boolean): void;
  /** The current value, re-rendering when it changes. */
  use(): boolean;
}

export function deviceSwitch(key: string, { defaultOn = true }: { defaultOn?: boolean } = {}): DeviceSwitch {
  const listeners = new Set<() => void>();
  /** What's stored for the value that isn't the default. */
  const stored = defaultOn ? 'off' : 'on';

  const read = (): boolean => {
    try {
      return (window.localStorage.getItem(key) === stored) !== defaultOn;
    } catch {
      return defaultOn;
    }
  };

  const write = (on: boolean): void => {
    try {
      if (on === defaultOn) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, stored);
    } catch {
      // No storage: the choice lasts until the page closes.
    }
    listeners.forEach((fn) => fn());
  };

  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) fn();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('storage', onStorage);
    };
  };

  return { key, read, write, use: () => useSyncExternalStore(subscribe, read, () => defaultOn) };
}
