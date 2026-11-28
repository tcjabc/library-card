import type { Decor } from '../staircase/drawBudget';

/**
 * The launch shelf (pure, unit-tested; docs/launch.md): the bookcase in the splash header that
 * assembles and fills with books when the app starts. It is decorative and never blocks anything:
 * the splash's button, reader tiles and Grown-ups link are usable from the first frame.
 *
 * - Whether it plays (`launchMode`): only on a cold start of the app at the splash (the initial
 *   hash is `#/` or empty, the navigation type is `navigate`, and it hasn't played in this tab's
 *   session), and only as the motion rules allow (Sky decoration and the system's reduced motion).
 * - What it does (`launchStep`): idle → playing → done; a skip or the end goes to done; done stays.
 * - When (`LAUNCH_TIMING`): Full builds the case and drops the books in about 1.8 s; Reduced fades
 *   the books in on a built case in about 0.6 s. Mirrored by the --duration-launch-* and --launch-*
 *   tokens in src/theme.css (a test keeps them equal).
 */

/** What the shelf does on this page: the whole build, the books fading in, or just the finished shelf. */
export type LaunchMode = 'full' | 'reduced' | 'still';

/** sessionStorage: set when the shelf plays, so a reload in this tab (an update) never replays it. */
export const LAUNCH_SEEN_KEY = 'library-card:launch-seen';

export interface LaunchContext {
  /** `location.hash` when the page started. */
  hash: string;
  /** The page's navigation type (PerformanceNavigationTiming.type), or null if the browser can't say. */
  navigationType: string | null;
  /** Whether it already played in this tab's session (LAUNCH_SEEN_KEY). */
  seen: boolean;
  /** The device's Sky decoration level. */
  decor: Decor;
  /** The system's reduced motion. */
  reducedMotion: boolean;
}

/** The splash's hashes: nothing, or `#/` (with no query: `#/?…` is a deep link too). */
export function isSplashHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/';
}

/**
 * What the shelf does on this page. It plays only on a cold start at the splash: a fresh
 * navigation (not a reload, not back/forward) to `#/` that hasn't played in this tab. A browser
 * that can't say how the page was reached counts as a fresh navigation; the session flag still
 * stops a replay. Then Sky decoration None or reduced motion shows the finished shelf, Reduced
 * fades the books in, Full builds it all.
 */
export function launchMode({ hash, navigationType, seen, decor, reducedMotion }: LaunchContext): LaunchMode {
  const cold = isSplashHash(hash) && (navigationType === null || navigationType === 'navigate') && !seen;
  if (!cold || reducedMotion || decor === 'none') return 'still';
  return decor === 'reduced' ? 'reduced' : 'full';
}

export type LaunchPhase = 'idle' | 'playing' | 'done';
export type LaunchEvent = { type: 'start'; mode: LaunchMode } | { type: 'skip' } | { type: 'end' };

/** The shelf's state after an event: start plays (or is done at once when still); skip and end finish; done stays done. */
export function launchStep(phase: LaunchPhase, event: LaunchEvent): LaunchPhase {
  if (phase === 'done') return 'done';
  if (event.type === 'start') return phase === 'idle' ? (event.mode === 'still' ? 'done' : 'playing') : phase;
  return 'done';
}

/** How many books the shelf holds: two rows of nine. */
export const LAUNCH_BOOKS = 18;
/** Books on each shelf. */
export const LAUNCH_BOOKS_PER_ROW = 9;
/** The structure parts that animate: two sides, three boards, the back. */
export const LAUNCH_PARTS = 6;

/** The timing (ms), mirrored by tokens in src/theme.css. */
export const LAUNCH_TIMING = {
  /** --duration-launch-side: the sides rise from 0. */
  side: 250,
  /** --launch-boards-start: the first board starts sliding in. */
  boardsStart: 150,
  /** --duration-launch-board: each board's slide (the boards start --launch-stagger apart). */
  board: 180,
  /** --launch-books-start: the first book starts dropping. */
  booksStart: 350,
  /** --launch-stagger: between one book (or board) and the next. */
  stagger: 60,
  /** --duration-launch-drop: one book's drop, with its small bounce. */
  drop: 420,
  /** --duration-launch-fade: Reduced: one book's fade. */
  fade: 260,
  /** --launch-fade-stagger: Reduced: between one book's fade and the next. */
  fadeStagger: 20,
  /** --duration-launch: when the shelf counts as done (its animations and will-change go). */
  total: 1800,
} as const;

/** When the last part of a mode's animation ends (ms), from the constants. */
export function launchEndsAt(mode: LaunchMode): number {
  const t = LAUNCH_TIMING;
  if (mode === 'still') return 0;
  const books = LAUNCH_BOOKS - 1;
  if (mode === 'reduced') return books * t.fadeStagger + t.fade;
  const sides = t.side;
  const boards = t.boardsStart + 2 * t.stagger + t.board;
  const drops = t.booksStart + books * t.stagger + t.drop;
  return Math.max(sides, boards, drops);
}

/** Never longer than this (ms), whatever the constants say. */
export const LAUNCH_CAP_MS = 2000;
