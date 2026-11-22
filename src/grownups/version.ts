import { isTimeZone } from '../lib/timezone';
import { fmt, strings } from '../strings';

/** What this build is (Settings > About). Injected by vite.config.ts as __BUILD_INFO__. */
export interface BuildInfo {
  version: string;
  sha: string;
  builtAt: string;
}

/** This build's info; a stand-in where nothing was injected (e.g. unit tests). */
export function currentBuildInfo(): BuildInfo {
  return typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { version: '0.0.0', sha: 'dev', builtAt: '' };
}

/** A build time for people, in `timeZone` (UTC if that isn't a real zone), e.g. "22 Nov 2026, 19:05". */
export function formatBuildTime(iso: string, timeZone: string, locale?: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return iso || '?';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: isTimeZone(timeZone) ? timeZone : 'UTC' }).format(date);
}

/** "Version 1.0.0 · 6cf19e9 · built 22 Nov 2026, 19:05" */
export function formatVersionLine(info: BuildInfo, timeZone: string, locale?: string): string {
  return fmt(strings.grownups.settings.version, {
    version: info.version,
    sha: info.sha,
    built: formatBuildTime(info.builtAt, timeZone, locale),
  });
}

export type UpdateCheck = 'up-to-date' | 'updating' | 'offline' | 'unavailable';

const CHECK_TIMEOUT_MS = 15_000;

/**
 * Asks the service worker registration to look for a new version. "updating": one was found
 * and is installing (the app reloads by itself once it takes over, as it does today);
 * "unavailable": no service worker here (development, or a browser without one).
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) return 'unavailable';
  const registration = await sw.getRegistration();
  if (!registration) return 'unavailable';
  if (navigator.onLine === false) return 'offline';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      registration.update(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out.')), CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return 'offline';
  } finally {
    clearTimeout(timer);
  }
  return registration.installing || registration.waiting ? 'updating' : 'up-to-date';
}
