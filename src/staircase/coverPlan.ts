/**
 * Which covers the Family Staircase draws, loads ahead of the camera, keeps and fades in (pure,
 * unit-tested). coverArt.ts does the loading, CanvasStack.tsx the drawing; the colours and the
 * cover's crop are coverColour.ts.
 */
import { FAN_CAP, LOD_MIN_PX } from './drawBudget';

// ---- Where covers are drawn ----

/** Top faces thinner than this on screen (px) stay a flat colour: the page edges' "big enough" rule. */
export const COVER_MIN_PX = LOD_MIN_PX;

/**
 * Whether a drawn top face shows its cover's picture: every book that is drawn at all (the whole
 * visible range, up to FAN_CAP each side), unless the face is too thin on screen to show it.
 */
export function showsPicture(thicknessPx: number): boolean {
  return thicknessPx >= COVER_MIN_PX;
}

// ---- Which covers are asked for ----

/** Which way the camera is going: up the pile (newer books, +1), down (-1), or at rest (0). */
export type Travel = -1 | 0 | 1;

/** The camera counts as at rest when it is this close to where it's going (books). */
export const AT_REST_EPSILON = 0.01;

export function travelOf(shown: number, target: number, epsilon = AT_REST_EPSILON): Travel {
  const d = target - shown;
  return Math.abs(d) <= epsilon ? 0 : d > 0 ? 1 : -1;
}

/** While moving: pictures for this many books beyond the drawn ones ahead of the camera… */
export const LOOK_AHEAD = 6;
/** …and this many behind it. */
export const LOOK_BEHIND = 2;
/** At rest: this many beyond the drawn ones each way. */
export const REST_SPARE = 3;
/** Colours are asked for this many books around the camera first (nearest first)… */
export const COLOUR_NEAR = 60;

/**
 * Every index of a pile of `count` outwards from `centre`, nearest first. Ties go the way the
 * camera travels; at rest, down the pile first (the books below the eye line show their top faces).
 */
export function outward(centre: number, count: number, travel: Travel): number[] {
  const out: number[] = [];
  if (count <= 0) return out;
  const c = Math.min(count - 1, Math.max(0, Math.round(centre)));
  const first: 1 | -1 = travel === 1 ? 1 : -1;
  out.push(c);
  for (let k = 1; out.length < count; k++) {
    for (const dir of [first, -first]) {
      const i = c + dir * k;
      if (i >= 0 && i < count) out.push(i);
    }
  }
  return out;
}

export interface CoverJob {
  index: number;
  /** Its picture too (else its colour only). */
  picture: boolean;
}

/**
 * What to load, in order, for a camera at `centre` drawing [from, to) of `count` books:
 *
 * 1. the drawn books (picture and colour), nearest first;
 * 2. pictures beyond them: LOOK_AHEAD books the way the camera travels, then LOOK_BEHIND the
 *    other way (at rest, REST_SPARE each way, nearest first);
 * 3. colours for the COLOUR_NEAR books nearest the camera, then (at rest) the rest of the pile
 *    outwards. While moving the list stops at COLOUR_NEAR: it's asked for again often, and the
 *    rest follows once the camera stops.
 *
 * Each index appears once, at its first (most wanted) place.
 */
export function coverJobs(centre: number, from: number, to: number, count: number, travel: Travel, colourNear = COLOUR_NEAR): CoverJob[] {
  const jobs: CoverJob[] = [];
  if (count <= 0) return jobs;
  const seen = new Set<number>();
  const add = (index: number, picture: boolean) => {
    if (index < 0 || index >= count || seen.has(index)) return;
    seen.add(index);
    jobs.push({ index, picture });
  };
  const lo = Math.max(0, from);
  const hi = Math.min(count, to);
  for (const i of outward(centre, count, travel)) if (i >= lo && i < hi) add(i, true);
  if (travel === 0) {
    for (let k = 1; k <= REST_SPARE; k++) {
      add(lo - k, true);
      add(hi - 1 + k, true);
    }
  } else {
    const [ahead, behind] = travel === 1 ? [(k: number) => hi - 1 + k, (k: number) => lo - k] : [(k: number) => lo - k, (k: number) => hi - 1 + k];
    for (let k = 1; k <= LOOK_AHEAD; k++) add(ahead(k), true);
    for (let k = 1; k <= LOOK_BEHIND; k++) add(behind(k), true);
  }
  // Colours: the nearest ones first, then outwards (one list, nearest first, is both).
  const order = outward(centre, count, travel);
  const colours = travel === 0 ? order.length : Math.min(order.length, colourNear);
  for (let n = 0; n < colours; n++) add(order[n], false);
  return jobs;
}

/** Work done in one idle slice: at most `cap` items, and only while the slice has time left (ms). */
export const SLICE_MIN_MS = 2;

export function sliceHasRoom(done: number, cap: number, remainingMs: number, minMs = SLICE_MIN_MS): boolean {
  return done < cap && remainingMs > minMs;
}

// ---- Which pictures are kept ----

/** Decoded pictures kept: more than the drawn books (FAN_CAP each side) and the look-ahead together. */
export const PICTURE_CAP = 48;
/** A picture is released only when its book is further than this from the camera (books), and the cap is exceeded. */
export const KEEP_DISTANCE = 24;

export interface KeptPicture {
  key: string;
  /** Its nearest book's distance from the camera (books); Infinity when it's no longer in the pile. */
  distance: number;
  /** One of its books is drawn now. */
  drawn: boolean;
  /** When it was last drawn or loaded (a counter: larger is more recent). */
  used: number;
}

/**
 * The pictures to release: none while there are at most `cap`; beyond it, only pictures whose
 * books are further than `keep` away and not drawn, the furthest (then least recently used)
 * first, just enough to get back to the cap. If too few may go, the cache stays over the cap
 * for now (it can't grow far: only books near the camera are ever loaded).
 */
export function evictions(pictures: readonly KeptPicture[], cap = PICTURE_CAP, keep = KEEP_DISTANCE): string[] {
  const excess = pictures.length - cap;
  if (excess <= 0) return [];
  return pictures
    .filter((p) => !p.drawn && p.distance > keep)
    .sort((a, b) => b.distance - a.distance || a.used - b.used)
    .slice(0, excess)
    .map((p) => p.key);
}

/** Whether a picture arriving now is still worth keeping: its book is near enough to be shown soon. */
export function worthKeeping(distance: number, keep = KEEP_DISTANCE): boolean {
  return distance <= keep;
}

/** The furthest a wanted picture can be: drawn books plus the look-ahead (for the docs and tests). */
export const FURTHEST_PICTURE = FAN_CAP + LOOK_AHEAD;

// ---- Fading in ----

/**
 * When a fade starts: a cover (picture or colour) arriving for a book on screen fades in from
 * `now`; one arriving off screen, or with reduced motion, just shows (undefined: no fade).
 */
export function fadeStart(onScreen: boolean, reduced: boolean, now: number): number | undefined {
  return onScreen && !reduced ? now : undefined;
}

/** How far a fade has got (0–1): 1 with no fade, with reduced motion or once `duration` (ms) has passed. */
export function fadeProgress(startedAt: number | undefined, now: number, duration: number, reduced: boolean): number {
  if (startedAt === undefined || reduced || !(duration > 0)) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / duration));
}
