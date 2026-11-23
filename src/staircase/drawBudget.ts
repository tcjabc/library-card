/**
 * How much the canvas book stack draws each frame (pure, unit-tested): which books, how much
 * detail on their page edges, when the dev overlays redraw, and at what resolution.
 */
import type { ProjectedFace } from './stackProjection';

// ---- Which books ----

/** Books drawn past the last one on screen, each way. */
export const FAN_SPARE = 1;
/** Never more than this many books either side of the centre one. */
export const FAN_CAP = 14;

/**
 * The books to draw, as [start, end) indexes (oldest first): outwards from the centre book while
 * they're on screen, plus `spare` more each way, at most `cap` either side. Books further from
 * the centre are further up or down the screen, so the first one off screen ends each side.
 */
export function visibleRange(
  centre: number,
  count: number,
  onScreen: (index: number) => boolean,
  spare: number = FAN_SPARE,
  cap: number = FAN_CAP,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const c = Math.min(count - 1, Math.max(0, Math.round(centre)));
  const reach = (direction: 1 | -1) => {
    let extra = 0;
    let n = 0;
    let off = false;
    for (let k = 1; k <= cap; k++) {
      const i = c + direction * k;
      if (i < 0 || i >= count) break;
      if (!off && !onScreen(i)) off = true;
      if (off) {
        if (extra >= spare) break;
        extra += 1;
      }
      n = k;
    }
    return n;
  };
  return { start: c - reach(-1), end: c + reach(1) + 1 };
}

/** The top and bottom (px) of a book's faces on screen (no allocation per corner: it runs every frame). */
export function faceSpan(faces: readonly ProjectedFace[]): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const f of faces) {
    const y0 = f.origin.y;
    const lo = y0 + Math.min(0, f.u.y) + Math.min(0, f.v.y);
    const hi = y0 + Math.max(0, f.u.y) + Math.max(0, f.v.y);
    if (lo < top) top = lo;
    if (hi > bottom) bottom = hi;
  }
  return { top, bottom };
}

// ---- Page-edge detail ----

/** Page edges further than this many books from the camera are drawn flat. */
export const LOD_DISTANCE = 4;
/** …and so are page faces thinner than this on screen (px). */
export const LOD_MIN_PX = 6;

/** How thin a face is on screen (px): its area over its longest edge. */
export function faceThickness(face: Pick<ProjectedFace, 'u' | 'v'>): number {
  const area = Math.abs(face.u.x * face.v.y - face.u.y * face.v.x);
  const longest = Math.max(Math.hypot(face.u.x, face.u.y), Math.hypot(face.v.x, face.v.y));
  return longest > 0 ? area / longest : 0;
}

/** Striped page edges up close, a flat fill with an outline far away or edge-on. */
export function pageDetail(booksFromCamera: number, thicknessPx: number): 'striped' | 'flat' {
  return Math.abs(booksFromCamera) > LOD_DISTANCE || thicknessPx < LOD_MIN_PX ? 'flat' : 'striped';
}

// ---- Overlays ----

/** The top-down inset redraws at most every this many frames. */
export const INSET_EVERY = 2;

export interface InsetState {
  centre: number;
  /** The camera's turn when it was last drawn (degrees). */
  angle: number;
  frame: number;
}

/**
 * Whether the inset is due: its centre book changed or the camera turned at least a degree since
 * it was last drawn, and at least INSET_EVERY frames have passed. `last` null = never drawn.
 */
export function insetDue(last: InsetState | null, next: InsetState, every: number = INSET_EVERY): boolean {
  if (last === null) return true;
  if (next.frame - last.frame < every) return false;
  return next.centre !== last.centre || Math.abs(Math.round(next.angle) - Math.round(last.angle)) >= 1;
}

/** Whether the tag needs new text: a different centre book or a different whole-degree turn. */
export function tagChanged(last: { step: number; degrees: number } | null, step: number, degrees: number): boolean {
  return last === null || last.step !== step || last.degrees !== degrees;
}

// ---- Resolution ----

/** The canvas scales the stack steps down through, sharpest first. */
export const SCALE_STEPS = [2, 1.5, 1.25, 1] as const;
/** Step down when frames average longer than this (ms)… */
export const SLOW_FRAME_MS = 22;
/** …over at least this many frames (about a second of motion). */
export const MIN_FRAMES_TO_DECIDE = 30;
/** How much motion to average over before deciding (ms). */
export const DECIDE_AFTER_MS = 1000;

/** The scale to draw at next: one step down if frames are slow, never up, never below 1. */
export function nextScale(current: number, averageFrameMs: number, frames: number = MIN_FRAMES_TO_DECIDE): number {
  if (!(current > 1)) return Math.max(1, current || 1);
  if (frames < MIN_FRAMES_TO_DECIDE || !(averageFrameMs > SLOW_FRAME_MS)) return current;
  for (const step of SCALE_STEPS) if (step < current - 1e-9) return step;
  return 1;
}

// ---- Benchmark overrides (developer tools) ----

/**
 * Everything the benchmark fixes while it runs. null = none: the stack follows its props and
 * steps its resolution down by itself, as in normal use.
 */
export interface StackOverrides {
  /** The canvas scale to draw at. */
  scale: number;
  /** Adaptive resolution (always off while benchmarking). */
  adaptive: false;
  /** Show and update the tag and the inset. */
  overlays: boolean;
  /** A coloured circle with an initial instead of the avatar emoji, to see what the emoji cost. */
  plainAvatars: boolean;
  settle: boolean;
  twist: number;
  /** How many spine labels the cache keeps while benchmarking (enough for every book a run shows). */
  labelCache: number;
}
