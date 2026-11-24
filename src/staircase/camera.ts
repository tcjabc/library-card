/**
 * The book stack's camera position (stage 2a, pure, unit-tested). The position `s` is a
 * continuous book index: 0 = the oldest book, count - 1 = the newest (the top of the pile).
 * Native scrolling sets where the camera is going (the target); the drawn position eases
 * towards it, and when scrolling stops it settles on the nearest whole book.
 */

/** Scroll px per book. */
export const PX_PER_BOOK = 56;
/** The ease's time constant (ms): about 63% of the way there in this long. */
export const EASE_MS = 110;
/** One ease step never covers more than this (ms), so a stalled frame doesn't jump. */
export const MAX_EASE_DT_MS = 50;
/** The ease counts as finished this close to its target (books). */
export const EASE_DONE = 0.002;
/** Settle this long after the last scroll event (ms). */
export const SETTLE_IDLE_MS = 140;

function lastIndex(count: number): number {
  return Math.max(0, Math.floor(count) - 1);
}

/** A position kept on the pile: [0, count - 1]. */
export function clampPosition(s: number, count: number): number {
  const max = lastIndex(count);
  if (!(s > 0)) return 0;
  return s > max ? max : s;
}

/** The camera position for a scroll offset: the newest book at scrollTop 0, one book per PX_PER_BOOK. */
export function scrollToPosition(scrollTop: number, count: number, px: number = PX_PER_BOOK): number {
  if (!(px > 0)) return lastIndex(count);
  return clampPosition(lastIndex(count) - Math.max(0, scrollTop) / px, count);
}

/** The scroll offset for a camera position (the inverse of scrollToPosition). */
export function positionToScroll(s: number, count: number, px: number = PX_PER_BOOK): number {
  return (lastIndex(count) - clampPosition(s, count)) * Math.max(0, px);
}

/** How tall the scroll area's content is, so scrollTop reaches the oldest book exactly. */
export function scrollHeight(count: number, viewportHeight: number, px: number = PX_PER_BOOK): number {
  return lastIndex(count) * Math.max(0, px) + Math.max(0, viewportHeight);
}

/** One frame of easing: moves part of the way to the target, never past it. */
export function easeStep(shown: number, target: number, dtMs: number, tauMs: number = EASE_MS, maxDtMs: number = MAX_EASE_DT_MS): number {
  const dt = Math.min(Math.max(0, Number.isFinite(dtMs) ? dtMs : 0), maxDtMs);
  if (!(tauMs > 0)) return target;
  return shown + (target - shown) * (1 - Math.exp(-dt / tauMs));
}

/**
 * The next drawn position, and whether the camera has arrived (then it is exactly on the
 * target and no more frames are needed). With reduced motion it arrives at once.
 */
export function stepCamera(shown: number, target: number, dtMs: number, reducedMotion: boolean): { shown: number; done: boolean } {
  if (reducedMotion) return { shown: target, done: true };
  const next = easeStep(shown, target, dtMs);
  if (Math.abs(target - next) < EASE_DONE) return { shown: target, done: true };
  return { shown: next, done: false };
}

/** Where to come to rest: the nearest whole book, on the pile. */
export function settleTarget(s: number, count: number): number {
  return clampPosition(Math.round(clampPosition(s, count)), count);
}

/** Arrow keys: the next whole book up (+1, newer) or down (-1, older) from where the camera is going. */
export function stepTarget(target: number, by: number, count: number): number {
  return settleTarget(Math.round(clampPosition(target, count)) + Math.sign(by), count);
}

/**
 * The resting rule (where the camera starts, and nothing else): a pile of `count` books fits
 * when all of it is in view above the eye line with its base book there (count - 1 <= k, k from
 * stackProjection.eyeLineBooks). The camera's range is always the whole pile, [0, count - 1],
 * whatever its size.
 */
export function pileFits(count: number, k: number): boolean {
  return Math.floor(count) - 1 <= Math.max(0, Math.floor(k));
}

/** Where the camera starts when the pile opens: the base book (0) if the pile fits, else the newest. */
export function startPosition(count: number, k: number): number {
  const last = Math.max(0, Math.floor(count) - 1);
  return pileFits(count, k) ? 0 : last;
}
