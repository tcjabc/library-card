import type { NoteTrigger, ParentNote, ReadEvent, ReaderJourney } from '../data';

/**
 * Which parent note a child should see now (pure, unit-tested). Worked out from synced data on
 * every device, so a note earned on one device (a grown-up confirming a read there) shows on
 * whichever device the child uses next.
 *
 * A note is earned by a moment: for "after a book", a book's FIRST read becoming confirmed (its
 * confirmation time, or its read time when it needed no check); re-reads and reads still waiting
 * for a grown-up never count. For "when they finish a journey", the journey's completion. For each
 * kind, the reader's lowest-placed unseen note is due when such a moment happened after they last
 * saw a note of that kind, and not before the note was written. One note at a time: seeing it
 * moves "last saw" on, so the next one needs a new moment. A journey note comes before a book
 * note (it follows the journey's celebration).
 */

/** When each book first counted as read (confirmed), one moment per book. */
export function firstReadMoments(events: readonly Pick<ReadEvent, 'isbn' | 'read_at' | 'status' | 'confirmed_at'>[]): string[] {
  const first = new Map<string, Pick<ReadEvent, 'read_at' | 'confirmed_at'>>();
  for (const e of events) {
    if (e.status === 'pending') continue;
    const seen = first.get(e.isbn);
    if (!seen || e.read_at < seen.read_at) first.set(e.isbn, e);
  }
  return [...first.values()].map((e) => e.confirmed_at ?? e.read_at);
}

/** When each journey was finished (not the ones given up). */
export function journeyMoments(history: readonly Pick<ReaderJourney, 'completed_at' | 'abandoned_at'>[]): string[] {
  return history.filter((j) => j.completed_at !== null && j.abandoned_at === null).map((j) => j.completed_at!);
}

export interface ReaderNote {
  note: Pick<ParentNote, 'id' | 'trigger' | 'position' | 'created_at'>;
  /** When this reader saw it, or null. */
  seen_at: string | null;
}

const ORDER: NoteTrigger[] = ['journey_done', 'after_book'];

export function dueNote<T extends ReaderNote>(notes: readonly T[], moments: Record<NoteTrigger, readonly string[]>): T | null {
  for (const trigger of ORDER) {
    const mine = notes.filter((n) => n.note.trigger === trigger);
    const next = mine
      .filter((n) => n.seen_at === null)
      .sort((a, b) => a.note.position - b.note.position || a.note.created_at.localeCompare(b.note.created_at))[0];
    if (!next) continue;
    const lastSeen = mine.reduce<string | null>((latest, n) => (n.seen_at && (!latest || n.seen_at > latest) ? n.seen_at : latest), null);
    const earned = moments[trigger].some((m) => (lastSeen === null || m > lastSeen) && m >= next.note.created_at);
    if (earned) return next;
  }
  return null;
}
