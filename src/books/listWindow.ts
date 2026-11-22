/**
 * Which List rows to put on the page (pure, unit-tested). A list of more than VIRTUALISE_OVER
 * books only renders the rows near the screen, with padding standing in for the rest, so a big
 * shelf scrolls smoothly. Rows can differ in height (a loan's Renewed / Returned), so each row's
 * height is given: measured once it has been on the page, an estimate before that.
 */

export const VIRTUALISE_OVER = 60;

export interface WindowRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

export function everything(itemCount: number): WindowRange {
  return { start: 0, end: itemCount, padTop: 0, padBottom: 0 };
}

/** The first rows of a list not measured yet. */
export function firstRows(itemCount: number): WindowRange {
  return { start: 0, end: Math.min(itemCount, 30), padTop: 0, padBottom: 0 };
}

/**
 * @param heights each row's height plus the gap after it, in px
 * @param top how far the top of the screen is below the top of the list (negative: the list starts lower down)
 * @param overscan extra px to render above and below the screen
 */
export function windowRange(heights: readonly number[], top: number, viewportHeight: number, overscan = 800): WindowRange {
  const n = heights.length;
  if (n === 0) return everything(0);
  const from = top - overscan;
  const to = top + viewportHeight + overscan;
  let y = 0;
  let start = 0;
  while (start < n - 1 && y + heights[start] <= from) y += heights[start++];
  const padTop = y;
  let end = start;
  while (end < n && (end === start || y < to)) y += heights[end++];
  let padBottom = 0;
  for (let i = end; i < n; i++) padBottom += heights[i];
  return { start, end, padTop, padBottom };
}

export function sameRange(a: WindowRange, b: WindowRange): boolean {
  return a.start === b.start && a.end === b.end && a.padTop === b.padTop && a.padBottom === b.padBottom;
}
