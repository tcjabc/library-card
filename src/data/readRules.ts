import { READ_TAP_GUARD_MS, type ReadEvent, type ReadSummary } from './DataStore';

/**
 * Pure rules for read events, shared by every adapter (and unit tested on
 * their own): the double-tap guard, which event is "latest", and how a
 * summary is built from events.
 */

/**
 * True when a tap at `nowMs` comes within `guardMs` of the reader's latest
 * read of the book and should be ignored. Works either side of `latestReadAt`,
 * so a latest read stamped slightly in the future (clock skew) also counts.
 */
export function isRepeatTap(latestReadAt: string | null | undefined, nowMs: number, guardMs = READ_TAP_GUARD_MS): boolean {
  if (!latestReadAt) return false;
  const latest = Date.parse(latestReadAt);
  return Number.isFinite(latest) && Math.abs(nowMs - latest) < guardMs;
}

/** The latest event: latest read_at, then the larger id. This is the one undo removes. */
export function latestEvent(events: readonly ReadEvent[]): ReadEvent | null {
  let best: ReadEvent | null = null;
  for (const e of events) {
    if (!best || e.read_at > best.read_at || (e.read_at === best.read_at && e.id > best.id)) best = e;
  }
  return best;
}

/** A summary after adding one event (a new summary when there was none). */
export function addToSummary(summary: ReadSummary | null, event: ReadEvent): ReadSummary {
  if (!summary) {
    return {
      reader_id: event.reader_id,
      isbn: event.isbn,
      household_id: event.household_id,
      first_read_at: event.read_at,
      last_read_at: event.read_at,
      count: 1,
    };
  }
  return {
    ...summary,
    first_read_at: event.read_at < summary.first_read_at ? event.read_at : summary.first_read_at,
    last_read_at: event.read_at > summary.last_read_at ? event.read_at : summary.last_read_at,
    count: summary.count + 1,
  };
}

/** The summary for one reader+book from all its events, or null when there are none. */
export function summarize(events: readonly ReadEvent[]): ReadSummary | null {
  let summary: ReadSummary | null = null;
  for (const event of events) summary = addToSummary(summary, event);
  return summary;
}
