import { CONFIRMED_BY_PIN, type MarkReadOptions, type ReadEvent, type ReadHow, type Reader } from '../data';

/**
 * "I read this!" for a child: first how ("By myself" / "With help"), then, for a child whose
 * reads need a grown-up's check, who checks it ("Confirm now" with the household PIN, or "Send"
 * for later). Grown-ups' own reads are recorded at once, as before. Pure, so it's unit-tested.
 */

export type ReadStep = 'how' | 'check';

/** The questions before a read is recorded (none for a grown-up). */
export function readSteps(reader: Pick<Reader, 'kind' | 'needs_check'>): ReadStep[] {
  if (reader.kind === 'grown_up') return [];
  return reader.needs_check ? ['how', 'check'] : ['how'];
}

/** How the check went: no check needed, confirmed now with the PIN (or gate), or sent for later. */
export type CheckChoice = 'none' | 'confirm-now' | 'send';

/** What to record for a read. */
export function readRecord(how: ReadHow | null, choice: CheckChoice): MarkReadOptions {
  switch (choice) {
    case 'none':
      return { how, status: 'confirmed' };
    case 'confirm-now':
      return { how, status: 'confirmed', confirmedBy: CONFIRMED_BY_PIN };
    case 'send':
      return { how, status: 'pending' };
  }
}

/** Books this reader has a read waiting for a grown-up for. */
export function waitingBooks(pending: readonly Pick<ReadEvent, 'reader_id' | 'isbn' | 'status'>[], readerId: string): Set<string> {
  return new Set(pending.filter((e) => e.reader_id === readerId && e.status === 'pending').map((e) => e.isbn));
}

export type ReadButtonState = { kind: 'first' | 'again'; disabled: boolean } | { kind: 'waiting'; disabled: true };

/**
 * The read button for a book: "I read this!" (never read), "Read again!" (read before), or
 * "⏳ Waiting for a grown-up" (a read waiting to be checked: no more reads of it until then).
 * Only confirmed reads make a book "read" (count).
 */
export function readButtonState(confirmedCount: number, waiting: boolean, busy = false): ReadButtonState {
  if (waiting) return { kind: 'waiting', disabled: true };
  return { kind: confirmedCount > 0 ? 'again' : 'first', disabled: busy };
}
