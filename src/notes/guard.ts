/**
 * The per-device "notes shown" guard: a note the child just thanked doesn't show again in the
 * moment before its synced "seen" record is written (or in another tab meanwhile). The synced
 * record (note_views) is what makes a note once per reader on every device; this only covers that
 * gap, so an entry lasts until the record exists here, and at most GUARD_MS. "Show again" therefore
 * works as soon as the record is gone. localStorage (the library-card: prefix: "Reset this device"
 * clears it); kept in memory when storage is blocked.
 */

const KEY = 'library-card:notes-shown';
export const GUARD_MS = 10 * 60_000;

let memory: Record<string, number> = {};

function read(): Record<string, number> {
  try {
    const text = window.localStorage.getItem(KEY);
    if (text === null) return memory;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return memory;
  }
}

function write(entries: Record<string, number>): void {
  memory = entries;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Kept in memory for this page.
  }
}

/** Just shown and thanked on this device (the key is noteViewId(note, reader)). */
export function markShown(key: string, now = Date.now()): void {
  write({ ...read(), [key]: now });
}

/** Still held back here: shown within GUARD_MS and its record not here yet. */
export function isGuarded(key: string, now = Date.now()): boolean {
  const at = read()[key];
  return at !== undefined && now - at < GUARD_MS;
}

/** Drops entries whose record has arrived (or that are too old), so "Show again" works at once. */
export function pruneGuard(recorded: ReadonlySet<string>, now = Date.now()): void {
  const entries = read();
  const kept = Object.fromEntries(Object.entries(entries).filter(([key, at]) => !recorded.has(key) && now - at < GUARD_MS));
  if (Object.keys(kept).length !== Object.keys(entries).length) write(kept);
}
