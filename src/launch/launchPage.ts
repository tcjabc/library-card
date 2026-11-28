import type { Decor } from '../staircase/drawBudget';
import { LAUNCH_SEEN_KEY, launchMode, type LaunchMode } from './launchRule';

/**
 * The launch shelf's once-per-page decision (docs/launch.md), from the browser: how this page was
 * reached, the hash it started at, and the session flag. Decided once, on the shelf's first
 * render, by reading only; once the shelf has been on screen, every later visit to the splash in
 * this page shows it finished, and the flag is written (when it played) right after that first
 * commit.
 */

/** The hash the page started at (this module loads with the app, before any redirect). */
const INITIAL_HASH = typeof window === 'undefined' ? '' : window.location.hash;

let decided: LaunchMode | null = null;
let shown = false;

function navigationType(): string | null {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? null;
  } catch {
    return null;
  }
}

function seen(): boolean {
  try {
    return window.sessionStorage.getItem(LAUNCH_SEEN_KEY) !== null;
  } catch {
    // No session storage: never replay within this page at least (`shown`).
    return false;
  }
}

/** What the shelf does now: this page's decision on its first render, the finished shelf after that. */
export function pageLaunchMode(decor: Decor, reducedMotion: boolean): LaunchMode {
  if (shown || typeof window === 'undefined') return 'still';
  decided ??= launchMode({ hash: INITIAL_HASH, navigationType: navigationType(), seen: seen(), decor, reducedMotion });
  return decided;
}

/** The shelf is on screen (after its first commit): later visits show it finished; a play sets the session flag. */
export function markLaunchShown(played: boolean): void {
  shown = true;
  if (!played) return;
  try {
    window.sessionStorage.setItem(LAUNCH_SEEN_KEY, '1');
  } catch {
    // No session storage: a reload may play it again; nothing else is affected.
  }
}
