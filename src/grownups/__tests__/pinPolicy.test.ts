import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN_ACTIONS, pinStep, type PinState } from '../pinPolicy';
import { PIN_UNLOCK_MS, endGrownUpSession, isPinUnlocked, unlockGrownUp, unlockPinActions } from '../session';

// Which actions the household PIN guards (src/grownups/pinPolicy.ts) and the 2-minute window
// (src/grownups/session.ts).

const SENSITIVE = ['addDevice', 'turnOffSync', 'deleteHousehold', 'resetDevice', 'restoreBackup', 'changePin', 'removePin'];
/** Everything else stays behind the gate only. */
const OTHERS = [
  'startSync', 'joinHousehold', 'syncNow', 'setPin', 'forgotPin', 'downloadBackup', 'renameHousehold', 'setTimeZone',
  'addBook', 'removeBook', 'deleteReader', 'rotateCard', 'deleteLibrary', 'deleteLoan', 'clearReads', 'printCards',
];

const state = (over: Partial<PinState> = {}): PinState => ({ hasPin: true, syncing: true, unlocked: false, ...over });

describe('pinStep', () => {
  it('guards exactly the listed actions', () => {
    expect([...PIN_ACTIONS].sort()).toEqual([...SENSITIVE].sort());
  });

  it('with a PIN, each guarded action asks for it, synced or not', () => {
    for (const action of SENSITIVE) {
      expect(pinStep(action, state())).toBe('ask');
      expect(pinStep(action, state({ syncing: false }))).toBe('ask');
    }
  });

  it('no other action asks, in any state', () => {
    for (const action of OTHERS) {
      for (const over of [{}, { hasPin: false }, { syncing: false }, { hasPin: false, syncing: false }]) {
        expect(pinStep(action, state(over))).toBe('none');
      }
    }
  });

  it('a PIN entered in the last 2 minutes isn’t asked again', () => {
    for (const action of SENSITIVE) expect(pinStep(action, state({ unlocked: true }))).toBe('none');
  });

  it('no PIN, not syncing: as before (gate only)', () => {
    for (const action of SENSITIVE) expect(pinStep(action, state({ hasPin: false, syncing: false }))).toBe('none');
  });

  it('no PIN, syncing: set one first (changing or removing has nothing to guard)', () => {
    for (const action of SENSITIVE) {
      expect(pinStep(action, state({ hasPin: false }))).toBe(action === 'changePin' || action === 'removePin' ? 'none' : 'setFirst');
    }
  });
});

describe('the screens use it', () => {
  it('every guarded action goes through runProtected, in the screens that offer it', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const where: Record<string, string> = {
      addDevice: 'sync/SyncSection.tsx',
      turnOffSync: 'sync/SyncSection.tsx',
      deleteHousehold: 'sync/SyncSection.tsx',
      resetDevice: 'tabs/SettingsTab.tsx',
      restoreBackup: 'tabs/SettingsTab.tsx',
      changePin: 'pin/HouseholdPinSection.tsx',
      removePin: 'pin/HouseholdPinSection.tsx',
    };
    for (const action of PIN_ACTIONS) {
      expect(read(where[action]), action).toContain(`runProtected('${action}'`);
    }
    // The old gate-only path is gone from those screens.
    for (const file of new Set(Object.values(where))) expect(read(file), file).not.toContain('runAsGrownUp(');
  });
});

describe('the 2-minute window', () => {
  let now: number;

  beforeEach(() => {
    const session = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => void session.set(k, v),
        removeItem: (k: string) => void session.delete(k),
      },
    });
    now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    unlockGrownUp();
  });

  afterEach(() => {
    endGrownUpSession();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const PIN_A = 'pbkdf2-sha256$300000$saltsaltsaltsaltsaltsa$hashAhashAhashAhashAhashAhashAhashAhashAhas';
  const PIN_B = 'pbkdf2-sha256$300000$saltsaltsaltsaltsaltsa$hashBhashBhashBhashBhashBhashBhashBhashBhas';

  it('lasts 2 minutes after a right PIN', () => {
    expect(isPinUnlocked(PIN_A)).toBe(false);
    unlockPinActions(PIN_A);
    expect(isPinUnlocked(PIN_A)).toBe(true);
    vi.advanceTimersByTime(PIN_UNLOCK_MS - 1000);
    expect(isPinUnlocked(PIN_A)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(isPinUnlocked(PIN_A)).toBe(false);
  });

  it('ends when leaving Grown-ups, and doesn’t carry into a new grown-up session', () => {
    unlockPinActions(PIN_A);
    endGrownUpSession();
    expect(isPinUnlocked(PIN_A)).toBe(false);
    unlockGrownUp();
    expect(isPinUnlocked(PIN_A)).toBe(false);
    unlockPinActions(PIN_A);
    unlockGrownUp(); // passing the gate again starts a new session
    expect(isPinUnlocked(PIN_A)).toBe(false);
  });

  it('a PIN changed since (another device, or joining a household) must be entered again', () => {
    unlockPinActions(PIN_A);
    expect(isPinUnlocked(PIN_B)).toBe(false);
    expect(isPinUnlocked(null)).toBe(false);
    expect(isPinUnlocked(PIN_A)).toBe(true);
  });
});
