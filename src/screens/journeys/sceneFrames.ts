/**
 * Measuring a journey screen's frames for the slow-device drop-out (src/journeys/sceneBudget.ts,
 * docs/journeys.md), only while there's something to measure: `keepAlive(ms)` opens (or stretches)
 * a window, and an animation-frame loop runs until it closes, then stops by itself. Idle and
 * healthy, the screen has no loop and no timer. The first frame of each window only sets the clock
 * (no gap is measured across an idle stretch).
 *
 * The browser is passed in (`FrameHost`), so this runs unchanged in the unit tests.
 */

export interface FrameHost {
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  /** The clock the frame callbacks' times use (performance.now). */
  now(): number;
}

export interface FrameSampler {
  /** Measure frames for at least `ms` more (from now). Ignored once stopped. */
  keepAlive(ms: number): void;
  /** Stop for good (the screen closed, or there's nothing left to lower). */
  stop(): void;
  /** Whether a frame is waiting to be measured. */
  readonly running: boolean;
}

/** Calls `onFrame(dt)` with each measured frame's length (ms) while a window is open. */
export function frameSampler(host: FrameHost, onFrame: (dt: number) => void): FrameSampler {
  let handle = 0;
  let last = 0;
  let until = 0;
  let stopped = false;
  const tick = (now: number) => {
    handle = 0;
    if (stopped) return;
    if (last > 0) onFrame(now - last);
    if (stopped) return;
    if (now < until) {
      last = now;
      handle = host.requestAnimationFrame(tick);
    } else {
      last = 0;
    }
  };
  return {
    keepAlive(ms) {
      if (stopped) return;
      until = Math.max(until, host.now() + ms);
      if (!handle) handle = host.requestAnimationFrame(tick);
    },
    stop() {
      stopped = true;
      if (handle) host.cancelAnimationFrame(handle);
      handle = 0;
      last = 0;
    },
    get running() {
      return handle !== 0;
    },
  };
}

/** The real browser as a FrameHost. */
export function browserFrameHost(): FrameHost {
  return {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}
