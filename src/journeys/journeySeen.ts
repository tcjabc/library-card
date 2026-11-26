/**
 * The journey step a reader last saw on this device (pure, unit-tested; the
 * Family Staircase's stackSeen.ts pattern): so the journey screen's scene can
 * settle once from the old step to the new one, and never replays on every
 * visit. Device-local, per reader and per journey (its record id, so a new
 * journey starts fresh): localStorage `library-card:journey-seen:<readerId>:<recordId>`,
 * not synced, not in backups, cleared by "Reset this device" with the app's
 * other `library-card:` keys.
 */

export const JOURNEY_SEEN_PREFIX = 'library-card:journey-seen:';

export function journeySeenKey(readerId: string, recordId: string): string {
  return `${JOURNEY_SEEN_PREFIX}${readerId}:${recordId}`;
}

/** A stored step, or null when there's none (or it isn't a whole number ≥ 0). */
export function parseSeenStep(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * Where the scene settles from when the screen opens: the step last seen, when
 * the reader has climbed since; null for no settle (first visit, no change, a
 * step lost to an undo, or motion off).
 */
export function settleFrom(seen: number | null, progress: number, motion: boolean): number | null {
  if (!motion || seen === null || !(progress > seen)) return null;
  return seen;
}

export interface JourneySeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads and writes one reader's seen step for one journey; storage errors mean "nothing seen" and "not saved". */
export function readSeenStep(storage: JourneySeenStorage | null, readerId: string, recordId: string): number | null {
  try {
    return parseSeenStep(storage?.getItem(journeySeenKey(readerId, recordId)) ?? null);
  } catch {
    return null;
  }
}

export function writeSeenStep(storage: JourneySeenStorage | null, readerId: string, recordId: string, step: number): void {
  try {
    storage?.setItem(journeySeenKey(readerId, recordId), String(Math.max(0, Math.floor(step))));
  } catch {
    // No storage: the settle may play again next time.
  }
}

/**
 * Opening the screen: the step to settle from (or null), and the current step
 * recorded straight away, so it never replays, whatever the motion setting.
 */
export function openJourney(storage: JourneySeenStorage | null, readerId: string, recordId: string, progress: number, motion: boolean): number | null {
  const from = settleFrom(readSeenStep(storage, readerId, recordId), progress, motion);
  writeSeenStep(storage, readerId, recordId, progress);
  return from;
}
