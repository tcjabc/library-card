import { useSyncExternalStore } from 'react';
import { HOUSEHOLD_ID, type DataStore, type ReaderJourney } from '../data';

/**
 * Which finished journeys this device has already celebrated: a list of reader_journeys ids,
 * per device (localStorage; never synced or backed up, cleared by "Reset this device").
 *
 * Any completed journey not in the list celebrates once, the next time its reader is active on
 * this device, wherever it was completed (this device, another tab, or another device through
 * sync). The list is seeded with every completion that already exists (first run of this
 * version, starting or joining sync, replacing with the household's data, restoring a backup),
 * so a new device never replays old celebrations.
 *
 * Every storage access is wrapped: storage can throw (private mode, blocked site data, no window
 * in tests); the list is then kept in memory for this page.
 */

const LIST_KEY = 'library-card:celebrated';
/** Set while a tab replaces or merges data, so every tab holds celebrations: "paused until" (ms). */
const PAUSE_KEY = 'library-card:celebrations-paused';
/** A pause left behind by a closed tab ends by itself. */
const PAUSE_MAX_MS = 2 * 60_000;
/** The flags of the previous version: "celebrate this journey id for this reader". */
const LEGACY_PREFIX = 'library-card:celebrate:';

let memory: string[] | null = null;
let paused = 0;
let version = 0;
const listeners = new Set<() => void>();

const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

function readRaw(): string[] | null {
  try {
    const text = window.localStorage.getItem(LIST_KEY);
    if (text === null) return memory;
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return memory;
  }
}

function writeRaw(ids: Iterable<string>): void {
  memory = [...new Set(ids)];
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(memory));
  } catch {
    // Keep the in-memory list.
  }
  notify();
}

/** The celebrated ids, or null before the list was ever made on this device. */
export function getCelebrated(): Set<string> | null {
  const raw = readRaw();
  return raw === null ? null : new Set(raw);
}

/** This completion was celebrated (or shouldn't be): never show it again on this device. */
export function markCelebrated(readerJourneyId: string): void {
  writeRaw([...(readRaw() ?? []), readerJourneyId]);
}

const isCompleted = (j: ReaderJourney) => j.completed_at !== null && j.abandoned_at === null;

/** The completion to celebrate next for a reader: finished, not celebrated here, oldest first. */
export function nextCelebration(history: readonly ReaderJourney[], celebrated: ReadonlySet<string>): ReaderJourney | null {
  return (
    history
      .filter((j) => isCompleted(j) && !celebrated.has(j.id))
      .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!) || a.id.localeCompare(b.id))[0] ?? null
  );
}

/** The previous version's pending flags: readerId -> journey id (definition). */
function legacyFlags(): Map<string, string> {
  const flags = new Map<string, string>();
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith(LEGACY_PREFIX)) continue;
      const journeyId = window.localStorage.getItem(key);
      if (journeyId) flags.set(key.slice(LEGACY_PREFIX.length), journeyId);
    }
  } catch {
    // No storage: no flags.
  }
  return flags;
}

function clearLegacyFlags(readerIds: Iterable<string>): void {
  try {
    for (const id of readerIds) window.localStorage.removeItem(LEGACY_PREFIX + id);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Add every completion that exists now to the list (starting or joining sync, replacing with the
 * household's data, restoring a backup). With keepLegacyPending, a celebration the previous
 * version still had waiting (its flag) stays due.
 */
export async function markAllCompletionsCelebrated(store: DataStore, { keepLegacyPending = false } = {}): Promise<void> {
  const readers = await store.listReaders(HOUSEHOLD_ID);
  const flags = keepLegacyPending ? legacyFlags() : new Map<string, string>();
  const ids = new Set(readRaw() ?? []);
  for (const reader of readers) {
    const done = (await store.listJourneyHistory(reader.id)).filter(isCompleted);
    // Leave the newest completion of a flagged journey due, so it still celebrates once.
    const flagged = flags.get(reader.id);
    const keep = flagged
      ? done.filter((j) => j.journey_id === flagged).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0]?.id
      : undefined;
    for (const j of done) if (j.id !== keep) ids.add(j.id);
  }
  writeRaw(ids);
  clearLegacyFlags(flags.keys());
}

/** First run of this version on a device: make the list (keeping a celebration still waiting). */
export async function ensureCelebrationList(store: DataStore): Promise<void> {
  if (readRaw() === null) await markAllCompletionsCelebrated(store, { keepLegacyPending: true });
}

/**
 * Hold celebrations back while sync replaces or merges data (join, replace), until the new
 * completions have been added to the list. Returns the function that resumes them.
 */
export function pauseCelebrations(): () => void {
  paused++;
  writePause(Date.now() + PAUSE_MAX_MS);
  notify();
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    paused--;
    if (paused === 0) writePause(null);
    notify();
  };
}

/** Other tabs see the pause through storage (and its storage event). */
function writePause(until: number | null): void {
  try {
    if (until === null) window.localStorage.removeItem(PAUSE_KEY);
    else window.localStorage.setItem(PAUSE_KEY, String(until));
  } catch {
    // This tab's pause still holds.
  }
}

function pausedElsewhere(): boolean {
  try {
    const until = Number(window.localStorage.getItem(PAUSE_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export const celebrationsPaused = () => paused > 0 || pausedElsewhere();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LIST_KEY || event.key === PAUSE_KEY) notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-renders when the list or the pause changes (here or in another tab); returns the list (null before it exists) and the pause. */
export function useCelebrationList(): { celebrated: Set<string> | null; paused: boolean } {
  useSyncExternalStore(subscribe, () => version, () => version);
  return { celebrated: getCelebrated(), paused: celebrationsPaused() };
}

/** Tests: forget the list and the pause. */
export function resetCelebrationsForTests(): void {
  memory = null;
  paused = 0;
  try {
    window.localStorage.removeItem(LIST_KEY);
    window.localStorage.removeItem(PAUSE_KEY);
  } catch {
    // No storage.
  }
  notify();
}
