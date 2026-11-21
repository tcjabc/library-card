import { useSyncExternalStore } from 'react';
import type { Reader, ReadSummary } from '../../data';

/**
 * Dev-only: show the Family Staircase with pretend steps, to check it stays
 * smooth with lots of books. Switched on from the grown-up tools page, per
 * tab (sessionStorage), and never written to the database.
 */

const KEY = 'library-card:fake-staircase';
const listeners = new Set<() => void>();

export const FAKE_STAIRCASE_STEPS = 1000;

export function getFakeStaircaseSteps(): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setFakeStaircaseSteps(count: number | null): void {
  try {
    if (count) window.sessionStorage.setItem(KEY, String(count));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the fake staircase isn't available.
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useFakeStaircaseSteps(): number | null {
  return useSyncExternalStore(subscribe, getFakeStaircaseSteps, () => null);
}

/** Pretend first reads, shared round the household's readers, one an hour from 1 Jan 2026. */
export function fakeReads(count: number, readers: readonly Reader[], householdId: string): ReadSummary[] {
  const ids = readers.length > 0 ? readers.map((r) => r.id) : ['fake-reader'];
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start + i * 3_600_000).toISOString();
    return {
      reader_id: ids[(i * 7 + (i >> 3)) % ids.length],
      isbn: `fake-${String(i + 1).padStart(5, '0')}`,
      household_id: householdId,
      first_read_at: at,
      last_read_at: at,
      count: 1,
    };
  });
}
