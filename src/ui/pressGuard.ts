/**
 * A number pad ignores presses for a moment after it opens, so the tap that opened it (a reader
 * tile, a button) can't land on a key that appears under the finger and enter a digit.
 */
export const PAD_OPEN_GUARD_MS = 300;

/** Whether a press at `now` counts, for a pad that opened at `openedAt` (same clock). */
export function padAcceptsPress(openedAt: number, now: number, guardMs: number = PAD_OPEN_GUARD_MS): boolean {
  return now - openedAt >= guardMs;
}

/** The clock pads use (milliseconds, monotonic). */
export const padClock = (): number => performance.now();

/** Whether a press now counts, for a pad that opened at `openedAt` (padClock time). */
export function padReady(openedAt: number): boolean {
  return padAcceptsPress(openedAt, padClock());
}
