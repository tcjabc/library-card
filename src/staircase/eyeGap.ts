/**
 * The gap around the eye-line book (pure, unit-tested): the books above the eye line lift away
 * and the books below drop a little, so the book being looked at shows its top face (with its
 * cover) and its spine almost in full. The gap travels smoothly with the camera: it depends on
 * t = index - s, the book's distance from the continuous camera position (as the fan's turn
 * does). The constants are in stackModel.ts, in book heights.
 */
import { GAP_BOOK_HEIGHT, GAP_DOWN, GAP_RAMP, GAP_UP } from './stackModel';

/** The lift above (px): every book from one above the eye line up. */
export const GAP_UP_PX = GAP_UP * GAP_BOOK_HEIGHT;
/** The drop below (px). */
export const GAP_DOWN_PX = GAP_DOWN * GAP_BOOK_HEIGHT;

/** 0 up to `a`, 1 from `b`, an S-curve between (clamp, then u²(3 - 2u)). */
export function smoothstep(x: number, a: number, b: number): number {
  if (!(b > a)) return x >= b ? 1 : 0;
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * How far a book at `t` books from the camera moves up (px; negative: down): GAP_UP_PX for
 * t >= 1, -GAP_DOWN_PX for t <= -1, 0 at the eye line (|t| <= 0.3), and smoothly between.
 * Nothing at all with the gap off.
 */
export function eyeGapLift(t: number, on = true): number {
  if (!on || !Number.isFinite(t)) return 0;
  const [a, b] = GAP_RAMP;
  return GAP_UP_PX * smoothstep(t, a, b) - GAP_DOWN_PX * smoothstep(-t, a, b);
}

/** Book `index`'s lift with the camera at `s`. */
export function bookLift(index: number, s: number, on = true): number {
  return eyeGapLift(index - s, on);
}

/**
 * A month line's lift: the line lies between book `index` (the month's first book) and the one
 * under it, so it takes the average of their two lifts (in the middle of the gap when the gap is
 * there). Under the base book there's no book: the base book's own lift.
 */
export function lineLift(index: number, s: number, on = true): number {
  if (index <= 0) return bookLift(index, s, on);
  return (bookLift(index, s, on) + bookLift(index - 1, s, on)) / 2;
}

/** The extra room (px, in the pile) the lifted books take above the eye line: K must leave it. */
export function liftAbove(on: boolean): number {
  return on ? GAP_UP_PX : 0;
}
