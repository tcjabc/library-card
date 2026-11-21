/**
 * Journey progress, from a reader's read summaries. A step is filled by a
 * book whose FIRST read is at or after the journey started; re-reads of
 * books first read earlier don't count. Pure, so it is unit-tested.
 */

export interface FirstRead {
  isbn: string;
  first_read_at: string;
}

export interface FilledStep {
  /** 1-based. */
  step: number;
  isbn: string;
  first_read_at: string;
}

const firstReadOrder = (a: FirstRead, b: FirstRead) =>
  a.first_read_at.localeCompare(b.first_read_at) || a.isbn.localeCompare(b.isbn);

/** Books that count towards a journey started at `startedAt`, in the order they filled steps. */
function counting(firstReads: readonly FirstRead[], startedAt: string): FirstRead[] {
  return firstReads.filter((r) => r.first_read_at >= startedAt).sort(firstReadOrder);
}

/** Steps climbed: books first read since the start, capped at `steps`. */
export function journeyProgress(firstReads: readonly FirstRead[], startedAt: string, steps: number): number {
  return Math.min(steps, counting(firstReads, startedAt).length);
}

export function isComplete(progress: number, steps: number): boolean {
  return steps > 0 && progress >= steps;
}

/** Books still needed. */
export function booksToGo(progress: number, steps: number): number {
  return Math.max(0, steps - progress);
}

/**
 * Which book filled each step: by first_read_at, ties broken by isbn. Only
 * the first `steps` books count.
 */
export function filledSteps(firstReads: readonly FirstRead[], startedAt: string, steps: number): FilledStep[] {
  return counting(firstReads, startedAt)
    .slice(0, steps)
    .map((r, i) => ({ step: i + 1, isbn: r.isbn, first_read_at: r.first_read_at }));
}
