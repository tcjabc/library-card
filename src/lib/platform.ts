/**
 * Small platform checks. Parameters default to the real browser objects and
 * can be passed in by tests.
 */

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

export function isIos(nav: NavigatorLike = navigator): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; touch gives it away.
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** Running as an installed app (home screen) rather than in a browser tab. */
export function isInstalledApp(
  nav: NavigatorLike = navigator,
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis),
): boolean {
  if (nav.standalone === true) return true;
  return !!matchMedia?.('(display-mode: standalone)').matches;
}

/**
 * iOS in a browser tab (Safari or another browser), not the installed app.
 * The installed app keeps its own storage, separate from Safari's, so cards
 * scanned with the Camera app open in Safari, which knows no readers.
 */
export function isIosBrowserTab(
  nav: NavigatorLike = navigator,
  matchMedia?: (query: string) => { matches: boolean },
): boolean {
  return isIos(nav) && !isInstalledApp(nav, matchMedia ?? globalThis.matchMedia?.bind(globalThis));
}
