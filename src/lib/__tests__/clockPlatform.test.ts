import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPretendToday, onPretendTodayChange, setPretendToday, todayLocal } from '../clock';
import { formatCalendarDate } from '../dates';
import { requestPersistentStorage } from '../persist';
import { isInstalledApp, isIos, isIosBrowserTab } from '../platform';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSessionStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
  return data;
}

describe('test clock (pretend today)', () => {
  it('todayLocal is the real local date until a pretend date is set', () => {
    stubSessionStorage();
    expect(todayLocal(new Date('2026-02-02T02:00:00Z'))).toBe('2026-02-01'); // New York
    let changes = 0;
    const off = onPretendTodayChange(() => changes++);
    setPretendToday('2026-12-24');
    expect(getPretendToday()).toBe('2026-12-24');
    expect(todayLocal(new Date('2026-02-02T02:00:00Z'))).toBe('2026-12-24');
    setPretendToday(null);
    expect(getPretendToday()).toBeNull();
    off();
    expect(changes).toBe(2);
  });

  it('ignores invalid dates and broken storage', () => {
    stubSessionStorage();
    setPretendToday('2026-02-30');
    expect(getPretendToday()).toBeNull();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(getPretendToday()).toBeNull();
  });
});

describe('formatCalendarDate', () => {
  it('shows weekday, day and month, and the year only when it differs', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(formatCalendarDate('2026-03-13', 'en-GB', now)).toBe('Fri 13 Mar');
    expect(formatCalendarDate('2027-01-04', 'en-GB', now)).toBe('Mon, 4 Jan 2027');
  });
});

describe('platform', () => {
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1' };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
  const mac = { userAgent: ipad.userAgent, platform: 'MacIntel', maxTouchPoints: 0 };
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 11; Mi 9T) Chrome/158.0 Mobile Safari/537.36' };
  const browserTab = () => ({ matches: false });
  const installed = () => ({ matches: true });

  it('isIos: iPhone and iPadOS (which reports a Mac with touch), not a Mac or Android', () => {
    expect([isIos(iphone), isIos(ipad), isIos(mac), isIos(android)]).toEqual([true, true, false, false]);
  });

  it('isInstalledApp: navigator.standalone or display-mode standalone', () => {
    expect(isInstalledApp({ ...iphone, standalone: true }, browserTab)).toBe(true);
    expect(isInstalledApp(android, installed)).toBe(true);
    expect(isInstalledApp(iphone, browserTab)).toBe(false);
  });

  it('isIosBrowserTab: iOS and not installed', () => {
    expect(isIosBrowserTab(iphone, browserTab)).toBe(true);
    expect(isIosBrowserTab({ ...iphone, standalone: true }, browserTab)).toBe(false);
    expect(isIosBrowserTab(android, browserTab)).toBe(false);
  });
});

describe('requestPersistentStorage', () => {
  it('asks once, skips when already persisted, and never throws', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persisted: async () => false, persist } as unknown as StorageManager)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    const persist2 = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persisted: async () => true, persist: persist2 } as unknown as StorageManager)).toBe(true);
    expect(persist2).not.toHaveBeenCalled();
    expect(await requestPersistentStorage({ persist: async () => { throw new Error('no'); } } as unknown as StorageManager)).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBe(false);
  });
});
