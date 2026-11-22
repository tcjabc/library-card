import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isGrownUpUnlocked, isPinUnlocked } from '../../grownups/session';
import { splashTiles } from '../../screens/splashTiles';
import type { Reader } from '../../data';
import { getActiveReaderId, setActiveReaderId } from '../activeReader';
import {
  GROWN_UP_HIDDEN_GRACE_MS,
  GROWN_UP_IDLE_MS,
  grownUpSignOutReason,
  readGrownUpReaderSession,
  signInGrownUpReader,
  signInStep,
  signOutGrownUpReader,
  watchGrownUpReader,
} from '../grownUpReader';

// Grown-up readers on the splash (src/session/grownUpReader.ts): the household PIN (or the
// gate) to sign in, and signed out again after 5 idle minutes, when the page is hidden, or when
// the app was closed. Children are unchanged.

const T0 = Date.parse('2026-11-22T12:00:00Z');
const PIN_HASH = 'pbkdf2-sha256$300000$saltsaltsaltsaltsaltsa$hashAhashAhashAhashAhashAhashAhashAhashAhas';
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

let local: Map<string, string>;
let session: Map<string, string>;

beforeEach(() => {
  local = new Map();
  session = new Map();
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  vi.stubGlobal('window', { localStorage: storage(local), sessionStorage: storage(session), addEventListener() {}, removeEventListener() {} });
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('a grown-up needs the household PIN, or the gate when there is none; a child needs only their card', () => {
    expect(signInStep('grown_up', true)).toBe('pin');
    expect(signInStep('grown_up', false)).toBe('gate');
    expect(signInStep('child', true)).toBe('none');
    expect(signInStep('child', false)).toBe('none');
  });

  it('on the splash, a grown-up tile asks to sign in; a child tile opens the card scanner', () => {
    const reader = (id: string, kind: 'child' | 'grown_up') => ({ id, household_id: 'main', display_name: id, kind, avatar: '🦊', card_token: id, active_journey_id: null }) as Reader;
    expect(splashTiles([reader('mum', 'grown_up'), reader('ada', 'child')]).map((t) => [t.reader.id, t.signIn])).toEqual([
      ['ada', 'card'],
      ['mum', 'tap'],
    ]);
    const splash = read('screens/Splash.tsx');
    expect(splash).toContain("if (tile.signIn === 'tap') setSigningIn(tile.reader);");
    expect(splash).toContain('<GrownUpSignIn');
  });

  it('a scanned grown-up card asks too; a child card signs in at once, as before', () => {
    const card = read('screens/CardLink.tsx');
    expect(card).toContain("if (reader && reader.kind !== 'grown_up') {");
    expect(card).toContain('<GrownUpSignIn');
    expect(card).toContain("onCancel={() => navigate('/', { replace: true })}");
  });

  it('uses the same PIN prompt (and so the same wrong-try counter and waits) as the guarded Settings actions', () => {
    const signIn = read('screens/GrownUpSignIn.tsx');
    expect(signIn).toContain('<PinPrompt');
    expect(signIn).toContain('<ParentGate');
    expect(read('grownups/pin/PinGuardProvider.tsx')).toContain('<PinPrompt');
    const prompt = read('grownups/pin/PinPrompt.tsx');
    expect(prompt).toContain('readPinAttempts()');
    expect(prompt).toContain('writePinAttempts(next)');
  });

  it('signing in as a reader opens neither grown-up mode nor the 2-minute PIN window', () => {
    signInGrownUpReader('mum');
    expect(getActiveReaderId()).toBe('mum');
    expect(readGrownUpReaderSession()).toEqual({ readerId: 'mum', lastActive: T0 });
    expect(isGrownUpUnlocked()).toBe(false);
    expect(isPinUnlocked(PIN_HASH)).toBe(false);
    for (const file of ['screens/GrownUpSignIn.tsx', 'screens/Splash.tsx', 'screens/CardLink.tsx', 'session/grownUpReader.ts']) {
      const source = read(file);
      for (const opener of ['unlockPinActions', 'unlockGrownUp', 'requireGrownUp', 'runAsGrownUp']) expect(source, `${file}: ${opener}`).not.toContain(opener);
    }
  });
});

describe('signing out', () => {
  it('the rules: no session in this tab (closed and reopened), hidden over 60 s, or 5 idle minutes', () => {
    expect(GROWN_UP_HIDDEN_GRACE_MS).toBe(60_000);
    expect(grownUpSignOutReason('mum', { readerId: 'mum', lastActive: T0, hiddenAt: T0 }, T0 + 60_000)).toBeNull();
    expect(grownUpSignOutReason('mum', { readerId: 'mum', lastActive: T0, hiddenAt: T0 }, T0 + 60_001)).toBe('hidden');
    expect(grownUpSignOutReason('mum', null, T0)).toBe('closed');
    expect(grownUpSignOutReason('mum', { readerId: 'dad', lastActive: T0 }, T0)).toBe('closed');
    expect(grownUpSignOutReason('mum', { readerId: 'mum', lastActive: T0 }, T0 + GROWN_UP_IDLE_MS - 1)).toBeNull();
    expect(grownUpSignOutReason('mum', { readerId: 'mum', lastActive: T0 }, T0 + GROWN_UP_IDLE_MS)).toBe('idle');
    expect(GROWN_UP_IDLE_MS).toBe(5 * 60_000);
  });

  type Targets = NonNullable<Parameters<typeof watchGrownUpReader>[1]>;
  /** A fake window and document (events only) and the faked clock. */
  const targets = () => ({
    win: new EventTarget(),
    doc: Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }),
    now: () => Date.now(),
  });
  const watch = (t: ReturnType<typeof targets>) => watchGrownUpReader('mum', t as unknown as Targets);

  it('after 5 minutes without a tap or key', () => {
    signInGrownUpReader('mum');
    const stop = watch(targets());
    vi.advanceTimersByTime(GROWN_UP_IDLE_MS - 30_000);
    expect(getActiveReaderId()).toBe('mum');
    vi.advanceTimersByTime(45_000);
    expect(getActiveReaderId()).toBeNull();
    expect(readGrownUpReaderSession()).toBeNull();
    stop();
  });

  it('taps and keys keep them signed in', () => {
    signInGrownUpReader('mum');
    const t = targets();
    const stop = watch(t);
    vi.advanceTimersByTime(4 * 60_000);
    t.win.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(4 * 60_000);
    expect(getActiveReaderId()).toBe('mum');
    t.win.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(4 * 60_000);
    expect(getActiveReaderId()).toBe('mum');
    vi.advanceTimersByTime(90_000);
    expect(getActiveReaderId()).toBeNull();
    stop();
  });

  const hide = (t: ReturnType<typeof targets>, state: DocumentVisibilityState) => {
    t.doc.visibilityState = state;
    t.doc.dispatchEvent(new Event('visibilitychange'));
  };

  it('when the page stays hidden for more than 60 seconds (another app, the screen off)', () => {
    signInGrownUpReader('mum');
    const t = targets();
    const stop = watch(t);
    hide(t, 'hidden');
    vi.advanceTimersByTime(59_000);
    expect(getActiveReaderId()).toBe('mum');
    vi.advanceTimersByTime(3_000);
    expect(getActiveReaderId()).toBeNull();
    stop();
  });

  it('coming back after more than 60 seconds signs out even if no timer ran while hidden', () => {
    signInGrownUpReader('mum');
    const t = targets();
    const stop = watch(t);
    hide(t, 'hidden');
    // A phone asleep: the clock moves, timers don't.
    vi.setSystemTime(T0 + 90_000);
    hide(t, 'visible');
    expect(getActiveReaderId()).toBeNull();
    stop();
  });

  it('back within 60 seconds (the photo picker, the camera app): still signed in, and the next hide starts afresh', () => {
    signInGrownUpReader('mum');
    const t = targets();
    const stop = watch(t);
    hide(t, 'hidden');
    vi.advanceTimersByTime(40_000);
    hide(t, 'visible');
    expect(getActiveReaderId()).toBe('mum');
    expect(readGrownUpReaderSession()?.hiddenAt).toBeUndefined();
    t.win.dispatchEvent(new Event('pointerdown'));
    hide(t, 'hidden');
    vi.advanceTimersByTime(40_000);
    hide(t, 'visible');
    vi.advanceTimersByTime(60_000);
    expect(getActiveReaderId()).toBe('mum');
    stop();
  });

  it('a reload (or the system reloading the page) within 60 seconds keeps them; after 60 seconds it does not', () => {
    signInGrownUpReader('mum');
    let t = targets();
    let stop = watch(t);
    hide(t, 'hidden');
    stop();
    vi.setSystemTime(T0 + 30_000);
    t = targets(); // the reloaded page, showing
    stop = watchGrownUpReader('mum', t as unknown as Targets, { openedWithThem: true });
    expect(getActiveReaderId()).toBe('mum');
    expect(readGrownUpReaderSession()?.hiddenAt).toBeUndefined();
    hide(t, 'hidden');
    stop();
    vi.setSystemTime(T0 + 120_000);
    stop = watchGrownUpReader('mum', targets() as unknown as Targets, { openedWithThem: true });
    expect(getActiveReaderId()).toBeNull();
    stop();
  });

  it('when the app was closed and opened again (no session in this tab)', () => {
    setActiveReaderId('mum'); // still in localStorage from before
    session.clear();
    const stop = watchGrownUpReader('mum', targets() as unknown as Targets, { openedWithThem: true });
    expect(getActiveReaderId()).toBeNull();
    stop();
  });

  it('a grown-up signed in from another tab is left to that tab (the active reader is shared, sessions are not)', () => {
    setActiveReaderId('mum');
    session.clear();
    const t = targets();
    const stop = watch(t);
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(GROWN_UP_IDLE_MS * 2);
    expect(getActiveReaderId()).toBe('mum');
    stop();
  });

  it('children are never watched, and stopping the watch removes its listeners', () => {
    expect(read('session/GrownUpReaderGuard.tsx')).toContain("reader?.kind === 'grown_up' ? reader.id : null");
    signInGrownUpReader('mum');
    const t = targets();
    const stop = watch(t);
    stop();
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(GROWN_UP_IDLE_MS * 2);
    expect(getActiveReaderId()).toBe('mum');
    signOutGrownUpReader();
    expect(getActiveReaderId()).toBeNull();
  });
});
