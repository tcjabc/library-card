import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, currentBuildInfo, formatBuildTime, formatVersionLine } from '../version';

// Settings > About (src/grownups/version.ts): the version line and "Check for updates".

const info = { version: '1.0.0', sha: '6cf19e9', builtAt: '2026-11-22T11:05:00.000Z' };

describe('formatVersionLine', () => {
  it('shows the version, the commit and the build time in the household time zone', () => {
    expect(formatVersionLine(info, 'Asia/Taipei', 'en-GB')).toBe('Version 1.0.0 · 6cf19e9 · built 22 Nov 2026, 19:05');
    expect(formatVersionLine(info, 'Europe/London', 'en-GB')).toBe('Version 1.0.0 · 6cf19e9 · built 22 Nov 2026, 11:05');
  });

  it('crosses the date line when the zone does', () => {
    expect(formatBuildTime('2026-11-22T23:30:00.000Z', 'Pacific/Auckland', 'en-GB')).toBe('23 Nov 2026, 12:30');
    expect(formatBuildTime('2026-11-22T03:30:00.000Z', 'America/New_York', 'en-GB')).toBe('21 Nov 2026, 22:30');
  });

  it('falls back to UTC for an unknown zone, and shows a missing or broken time as it is', () => {
    expect(formatBuildTime(info.builtAt, 'Not/AZone', 'en-GB')).toBe('22 Nov 2026, 11:05');
    expect(formatBuildTime('', 'UTC', 'en-GB')).toBe('?');
    expect(formatBuildTime('yesterday', 'UTC', 'en-GB')).toBe('yesterday');
  });

  it('a "dev" build says so', () => {
    expect(formatVersionLine({ ...info, sha: 'dev' }, 'UTC', 'en-GB')).toBe('Version 1.0.0 · dev · built 22 Nov 2026, 11:05');
  });

  it('without injected build info (tests), a stand-in', () => {
    expect(currentBuildInfo()).toEqual({ version: '0.0.0', sha: 'dev', builtAt: '' });
  });
});

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const withRegistration = (registration: Partial<ServiceWorkerRegistration> | undefined, onLine = true) =>
    vi.stubGlobal('navigator', { onLine, serviceWorker: { getRegistration: async () => registration } });

  it('no service worker (development, old browsers): unavailable', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(await checkForUpdate()).toBe('unavailable');
    withRegistration(undefined);
    expect(await checkForUpdate()).toBe('unavailable');
  });

  it('nothing new: up to date', async () => {
    const update = vi.fn(async () => undefined);
    withRegistration({ update, installing: null, waiting: null } as unknown as ServiceWorkerRegistration);
    expect(await checkForUpdate()).toBe('up-to-date');
    expect(update).toHaveBeenCalledOnce();
  });

  it('a new version installing (or waiting): updating', async () => {
    withRegistration({ update: async () => undefined, installing: {}, waiting: null } as unknown as ServiceWorkerRegistration);
    expect(await checkForUpdate()).toBe('updating');
    withRegistration({ update: async () => undefined, installing: null, waiting: {} } as unknown as ServiceWorkerRegistration);
    expect(await checkForUpdate()).toBe('updating');
  });

  it('offline, a failed check or one that never answers: offline', async () => {
    const update = vi.fn(async () => undefined);
    withRegistration({ update } as unknown as ServiceWorkerRegistration, false);
    expect(await checkForUpdate()).toBe('offline');
    expect(update).not.toHaveBeenCalled();
    withRegistration({ update: async () => Promise.reject(new TypeError('Failed to fetch')) } as unknown as ServiceWorkerRegistration);
    expect(await checkForUpdate()).toBe('offline');
    vi.useFakeTimers();
    withRegistration({ update: () => new Promise(() => {}) } as unknown as ServiceWorkerRegistration);
    const pending = checkForUpdate();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBe('offline');
  });
});
