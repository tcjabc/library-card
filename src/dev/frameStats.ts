/** Dev only: frame timing for the book stack prototype's measurement panel (pure, unit-tested). */

export interface Frame {
  /** When the frame ran (ms, performance.now()). */
  at: number;
  /** Time since the frame before (ms). */
  dt: number;
}

/** One frame at 60 Hz (ms). */
export const FRAME_MS = 1000 / 60;

/** How many frames were skipped before a frame that took `dt` ms (0 for an on-time frame). */
export function missedFrames(dt: number, frameMs: number = FRAME_MS): number {
  if (!(dt > 0) || !(frameMs > 0)) return 0;
  return Math.max(0, Math.round(dt / frameMs) - 1);
}

/** Frames per second over the frames in the last `windowMs` before `now`, or null if there are none. */
export function framesPerSecond(frames: readonly Frame[], now: number, windowMs: number = 2000): number | null {
  let count = 0;
  let time = 0;
  for (const f of frames) {
    if (f.at <= now - windowMs || f.at > now || !(f.dt > 0)) continue;
    count += 1;
    time += f.dt;
  }
  return count > 0 && time > 0 ? (count * 1000) / time : null;
}
