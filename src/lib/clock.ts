import { useSyncExternalStore } from 'react';
import { isCalendarDate } from './dates';
import { calendarDateIn, currentTimeZone, onTimeZoneChange } from './timezone';

/**
 * "Today" for due dates, in the household's time zone (lib/timezone). A
 * grown-up can pretend it is another day (developer page), to see overdue and
 * due-soon books without waiting. The setting is per tab (sessionStorage) and
 * only affects due-date screens, never the timestamps the data layer records.
 */

const KEY = 'library-card:pretend-today';
const listeners = new Set<() => void>();

export function getPretendToday(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    return value && isCalendarDate(value) ? value : null;
  } catch {
    return null;
  }
}

export function setPretendToday(value: string | null): void {
  try {
    if (value && isCalendarDate(value)) window.sessionStorage.setItem(KEY, value);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: pretending isn't available.
  }
  listeners.forEach((l) => l());
}

export function onPretendTodayChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Today's date in the household's time zone, or the pretend date. */
export function todayLocal(now: Date = new Date()): string {
  return getPretendToday() ?? calendarDateIn(now, currentTimeZone());
}

function subscribeToday(listener: () => void): () => void {
  const offPretend = onPretendTodayChange(listener);
  const offZone = onTimeZoneChange(listener);
  return () => {
    offPretend();
    offZone();
  };
}

/** Today's date for rendering; follows the pretend date and the household's zone when they change. */
export function useToday(): string {
  return useSyncExternalStore(subscribeToday, () => todayLocal(), () => todayLocal());
}
