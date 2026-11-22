import type { ReaderKind } from '../data';
import { clearActiveReader, setActiveReaderId } from './activeReader';

/**
 * Grown-up readers sign in with the household PIN (or the gate, without one) and don't stay
 * signed in: 5 minutes without a tap or key, the page hidden for more than 60 seconds (another
 * app, another tab, the screen off) or the app closed and opened again all sign them out. Back
 * within 60 seconds (from the photo picker or the camera app, say) they are still signed in.
 * Children stay signed in as before. This is separate from grown-up mode (src/grownups/session.ts): signing
 * in as a reader never opens the grown-up area or the 2-minute PIN window.
 *
 * The session lives in sessionStorage, which goes when the tab or app is closed.
 */

export const GROWN_UP_IDLE_MS = 5 * 60_000;
/** How long the page may be hidden before a grown-up is signed out. */
export const GROWN_UP_HIDDEN_GRACE_MS = 60_000;
const KEY = 'library-card:grown-up-reader';

interface GrownUpReaderSession {
  readerId: string;
  lastActive: number;
  /** When the page was hidden (kept here so a page the system reloads still knows), else unset. */
  hiddenAt?: number;
}

let memory: GrownUpReaderSession | null = null;

export function readGrownUpReaderSession(): GrownUpReaderSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<GrownUpReaderSession>;
    if (typeof value.readerId !== 'string' || typeof value.lastActive !== 'number') return null;
    const session: GrownUpReaderSession = { readerId: value.readerId, lastActive: value.lastActive };
    if (typeof value.hiddenAt === 'number') session.hiddenAt = value.hiddenAt;
    return session;
  } catch {
    return memory;
  }
}

function writeSession(value: GrownUpReaderSession | null): void {
  memory = value;
  try {
    if (value === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Memory only for this page.
  }
}

/** What signing in needs for this reader. Children: their card (a tile opens the scanner). */
export function signInStep(kind: ReaderKind, hasPin: boolean): 'none' | 'pin' | 'gate' {
  if (kind !== 'grown_up') return 'none';
  return hasPin ? 'pin' : 'gate';
}

/** A grown-up passed the PIN (or gate): they are the active reader, for this session only. */
export function signInGrownUpReader(readerId: string, now: number = Date.now()): void {
  writeSession({ readerId, lastActive: now });
  setActiveReaderId(readerId);
}

/** A tap or key press: the 5 minutes start again. */
export function touchGrownUpReader(now: number = Date.now()): void {
  const session = readGrownUpReaderSession();
  if (session) writeSession({ ...session, lastActive: now });
}

/** The page was hidden (at `now`), or is showing again (null). */
function markHidden(at: number | null): void {
  const session = readGrownUpReaderSession();
  if (!session) return;
  const next: GrownUpReaderSession = { ...session };
  if (at === null) delete next.hiddenAt;
  else next.hiddenAt = at;
  writeSession(next);
}

/** Signs the grown-up out (back to the splash: reader screens send nobody there). */
export function signOutGrownUpReader(): void {
  writeSession(null);
  clearActiveReader();
}

/**
 * Why a signed-in grown-up must be signed out now, or null. "closed": no session for them in
 * this tab (the app was closed and opened again, or they signed in before this rule). "hidden":
 * the page has been hidden for more than 60 seconds. "idle": 5 minutes without a tap or key.
 */
export function grownUpSignOutReason(
  readerId: string,
  session: GrownUpReaderSession | null,
  now: number,
): 'closed' | 'hidden' | 'idle' | null {
  if (!session || session.readerId !== readerId) return 'closed';
  if (session.hiddenAt !== undefined && now - session.hiddenAt > GROWN_UP_HIDDEN_GRACE_MS) return 'hidden';
  return now - session.lastActive >= GROWN_UP_IDLE_MS ? 'idle' : null;
}

const CHECK_EVERY_MS = 15_000;
/** Taps and keys refresh the session at most this often. */
const TOUCH_EVERY_MS = 5_000;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

interface WatchTargets {
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now: () => number;
}

interface WatchOptions {
  /**
   * This tab opened with the grown-up already signed in (the active reader is shared by every
   * tab, the session isn't). Without a session here, the app was closed and opened again: sign
   * them out. Otherwise they signed in from another tab, which does the watching.
   */
  openedWithThem: boolean;
}

/**
 * While grown-up `readerId` is signed in in this tab: sign them out after 5 minutes without a tap
 * or key, or once the page has been hidden for more than 60 seconds; and if the app was closed
 * since, at once. Returns a stop function. Children are never watched (the caller only starts
 * this for a grown-up).
 */
export function watchGrownUpReader(
  readerId: string,
  targets: WatchTargets = { win: window, doc: document, now: Date.now },
  options: WatchOptions = { openedWithThem: false },
): () => void {
  const { win, doc, now } = targets;
  const session = readGrownUpReaderSession();
  if (!session || session.readerId !== readerId) {
    if (options.openedWithThem) signOutGrownUpReader();
    return () => {};
  }
  const expired = (at: number) => grownUpSignOutReason(readerId, readGrownUpReaderSession(), at) !== null;
  if (expired(now())) {
    signOutGrownUpReader();
    return () => {};
  }
  // Showing again within the grace (e.g. a reload while hidden): carry on.
  if (doc.visibilityState !== 'hidden') markHidden(null);

  let lastTouch = 0;
  const onActivity = () => {
    const at = now();
    if (at - lastTouch < TOUCH_EVERY_MS) return;
    lastTouch = at;
    // A limit that passed while timers slept (a phone asleep) still counts.
    if (expired(at)) signOutGrownUpReader();
    else touchGrownUpReader(at);
  };
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const onVisibility = () => {
    clearTimeout(graceTimer);
    const at = now();
    if (doc.visibilityState === 'hidden') {
      markHidden(at);
      // Timers may not run while hidden; coming back (below) checks again anyway.
      graceTimer = setTimeout(() => {
        if (expired(now())) signOutGrownUpReader();
      }, GROWN_UP_HIDDEN_GRACE_MS + 1_000);
    } else if (expired(at)) {
      signOutGrownUpReader();
    } else {
      markHidden(null);
    }
  };

  for (const type of ACTIVITY) win.addEventListener(type, onActivity, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => {
    if (expired(now())) signOutGrownUpReader();
  }, CHECK_EVERY_MS);

  return () => {
    for (const type of ACTIVITY) win.removeEventListener(type, onActivity, { capture: true });
    doc.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
    clearTimeout(graceTimer);
  };
}
