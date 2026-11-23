/** Dev only: frame timing for the book stack prototype's measurement panel (pure, unit-tested). */

export interface Frame {
  /** When the frame ran (ms, performance.now()). */
  at: number;
  /** Time since the frame before (ms). */
  dt: number;
  /** Book renders since the frame before (0 if not counted). */
  renders?: number;
}

/** One frame at 60 Hz (ms). */
export const FRAME_MS = 1000 / 60;

/** How many frames were skipped before a frame that took `dt` ms (0 for an on-time frame). */
export function missedFrames(dt: number, frameMs: number = FRAME_MS): number {
  if (!(dt > 0) || !(frameMs > 0)) return 0;
  return Math.max(0, Math.round(dt / frameMs) - 1);
}

/** Frames, and renders, over the frames in the last `windowMs` before `now`, and the time they took. */
function sumWindow(frames: readonly Frame[], now: number, windowMs: number): { count: number; renders: number; time: number } {
  let count = 0;
  let renders = 0;
  let time = 0;
  for (const f of frames) {
    if (f.at <= now - windowMs || f.at > now || !(f.dt > 0)) continue;
    count += 1;
    renders += f.renders !== undefined && f.renders > 0 ? f.renders : 0;
    time += f.dt;
  }
  return { count, renders, time };
}

/** Frames per second over the frames in the last `windowMs` before `now`, or null if there are none. */
export function framesPerSecond(frames: readonly Frame[], now: number, windowMs: number = 2000): number | null {
  const { count, time } = sumWindow(frames, now, windowMs);
  return count > 0 && time > 0 ? (count * 1000) / time : null;
}

/** Book renders per second over the same frames as framesPerSecond, or null if there are none. */
export function rendersPerSecond(frames: readonly Frame[], now: number, windowMs: number = 2000): number | null {
  const { count, renders, time } = sumWindow(frames, now, windowMs);
  return count > 0 && time > 0 ? (renders * 1000) / time : null;
}

/** One canvas draw: when it ran (ms, performance.now()) and how long it took (ms), plus optional counts. */
export interface DrawSample {
  at: number;
  ms: number;
  /** Faces drawn. */
  faces?: number;
  /** Canvas drawing calls made. */
  ops?: number;
}

export interface SampleStats {
  average: number;
  max: number;
}

/**
 * The average and largest of `value` over the samples in the last `windowMs` before `now`, or null
 * if there are none. Samples without a value (undefined, NaN or negative) are skipped.
 */
export function sampleStats<T extends { at: number }>(
  samples: readonly T[],
  now: number,
  windowMs: number,
  value: (sample: T) => number | undefined,
): SampleStats | null {
  let count = 0;
  let total = 0;
  let max = 0;
  for (const s of samples) {
    if (s.at <= now - windowMs || s.at > now) continue;
    const v = value(s);
    if (v === undefined || !(v >= 0)) continue;
    count += 1;
    total += v;
    max = Math.max(max, v);
  }
  return count > 0 ? { average: total / count, max } : null;
}

/** The average and longest draw over the draws in the last `windowMs` before `now`, or null if there are none. */
export function drawStats(samples: readonly DrawSample[], now: number, windowMs: number = 2000): SampleStats | null {
  return sampleStats(samples, now, windowMs, (s) => s.ms);
}
