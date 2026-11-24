/**
 * The Family Staircase's book sheet (pure, unit-tested): its three states, how taps, drags,
 * Escape and the browser's Back move between them, how tall each state is, and which book it
 * shows.
 *
 * - collapsed: the bar under the pile, as before (the book at the eye line).
 * - half: over the lower part of the screen, leaving the book at the eye line in view; the pile
 *   above still scrolls and the sheet follows the book at the eye line.
 * - full: the whole area under the header; the pile can't be reached (and isn't drawn).
 *
 * The sheet lies over the pile and never changes its size, so the camera and K stay as they are.
 */

export const SHEET_STATES = ['collapsed', 'half', 'full'] as const;
export type SheetState = (typeof SHEET_STATES)[number];

/** How much of the sheet shows in each state (px from the bottom of the page). */
export interface SheetHeights {
  collapsed: number;
  half: number;
  full: number;
}

/** A drag that ends faster than this (px per ms) is a flick: it goes on to the next state that way. */
export const FLICK_SPEED = 0.4;
/** A press that moves less than this (px) is a tap. */
export const TAP_SLOP = 8;

export type SheetEvent =
  /** A tap on the bar: collapsed opens to half; half or full closes. */
  | { type: 'tap' }
  | { type: 'escape' }
  /** The browser's Back button (or gesture). */
  | { type: 'back' }
  /** A drag on the bar ended with `visible` px showing, moving at `velocity` px/ms (up is positive). */
  | { type: 'drag'; visible: number; velocity: number; heights: SheetHeights };

export function isExpanded(state: SheetState): boolean {
  return state !== 'collapsed';
}

export function nextSheetState(state: SheetState, event: SheetEvent): SheetState {
  switch (event.type) {
    case 'tap':
      return state === 'collapsed' ? 'half' : 'collapsed';
    case 'escape':
    case 'back':
      return 'collapsed';
    case 'drag':
      return snapState(event.visible, event.velocity, event.heights);
  }
}

/**
 * Where a drag comes to rest: after a flick, the next state on in the flick's direction from
 * where the finger let go; otherwise the nearest state.
 */
export function snapState(visible: number, velocity: number, heights: SheetHeights): SheetState {
  const ordered = SHEET_STATES.map((state) => ({ state, height: heights[state] }));
  if (velocity >= FLICK_SPEED) {
    return ordered.find((s) => s.height > visible + 1)?.state ?? 'full';
  }
  if (velocity <= -FLICK_SPEED) {
    return [...ordered].reverse().find((s) => s.height < visible - 1)?.state ?? 'collapsed';
  }
  let best = ordered[0];
  for (const s of ordered) if (Math.abs(s.height - visible) < Math.abs(best.height - visible)) best = s;
  return best.state;
}

/** How much shows while the finger holds the sheet `dy` px above (positive) or below where it started. */
export function dragVisible(start: number, dy: number, heights: SheetHeights): number {
  return Math.min(heights.full, Math.max(heights.collapsed, start + dy));
}

export interface SheetLayout {
  /** The page's height (px). */
  page: number;
  /** The header's bottom edge, from the top of the page (px): the pile starts here. */
  headerBottom: number;
  /** The pile's height (px): its eye line is half-way down. */
  view: number;
  /** The collapsed bar's height, with the bottom safe area (px). */
  bar: number;
  /** How far below the eye line the book there can reach, with a gap (px; stackProjection.eyeLineReach). */
  reach: number;
  /** The least the half state adds over the bar (px), on screens too short to leave the book in view. */
  minHalf: number;
}

export function sheetHeights({ page, headerBottom, view, bar, reach, minHalf }: SheetLayout): SheetHeights {
  const full = Math.max(bar, page - headerBottom);
  // The sheet's top edge sits just below the book at the eye line.
  const halfTop = headerBottom + view / 2 + reach;
  const half = Math.min(full, Math.max(page - halfTop, bar + minHalf));
  return { collapsed: bar, half, full };
}

/** In half (and collapsed) the sheet shows the book at the eye line; full keeps the book it opened on. */
export function sheetBook<T>(state: SheetState, centre: T | null, held: T | null): T | null {
  return state === 'full' ? (held ?? centre) : centre;
}

/**
 * The browser history entry the sheet keeps while it's open, so Back closes it: "push" one when
 * it opens, "pop" it when it closes some other way (a tap, a drag, Escape), nothing when Back
 * itself closed it or it moves between half and full.
 */
export function historyStep(prev: SheetState, next: SheetState, byBack: boolean): 'push' | 'pop' | null {
  if (!isExpanded(prev) && isExpanded(next)) return 'push';
  if (isExpanded(prev) && !isExpanded(next)) return byBack ? null : 'pop';
  return null;
}
