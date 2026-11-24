/**
 * "Since your last visit" for the Family Staircase (pure rules, unit-tested; the storage is
 * injected so the rules run anywhere). For each reader, on this device only, the number of stack
 * books they had seen when they last left the screen (or hid the app) is kept in localStorage
 * under `library-card:stack-seen:<readerId>`: never synced, not in backups, cleared by "Reset
 * this device" with the app's other `library-card:` keys. The books added since then fall onto
 * the pile when they open it (dropMotion.ts).
 */

export const SEEN_PREFIX = 'library-card:stack-seen:';

/** More new books than this aren't dropped: they show in place with a brief highlight. */
export const MAX_DROP = 40;

export function seenKey(readerId: string): string {
  return `${SEEN_PREFIX}${readerId}`;
}

/**
 * What the stored value says: a count of books seen, or (from developer tools' "Pretend I've
 * been away" before the reader's first visit) `behind` books fewer than the pile has when it next
 * opens. Null when there's nothing usable: the reader's first visit on this device.
 */
export type Seen = { seen: number } | { behind: number } | null;

export function parseSeen(text: string | null): Seen {
  if (text === null) return null;
  const behind = /^-(\d{1,7})$/.exec(text.trim());
  if (behind) return { behind: Number(behind[1]) };
  const n = /^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 ? { seen: n } : null;
}

/** How the screen greets the books added since the last visit. */
export type Arrival =
  /** The reader's first visit on this device: nothing falls, the count is recorded. */
  | { kind: 'first'; count: 0 }
  /** Nothing new (or the pile shrank): nothing falls. */
  | { kind: 'none'; count: 0 }
  /** `count` new books fall onto the pile. */
  | { kind: 'drop'; count: number }
  /** `count` new books simply show, with a brief highlight (too many to drop, or reduced motion). */
  | { kind: 'highlight'; count: number };

/** The rule: New = total - seen; first visit, nothing new, up to MAX_DROP falling, more highlighted (and reduced motion: highlighted). */
export function arrival(total: number, seen: Seen, reducedMotion: boolean): Arrival {
  if (seen === null) return { kind: 'first', count: 0 };
  const before = 'seen' in seen ? seen.seen : Math.max(0, total - seen.behind);
  const fresh = Math.floor(total) - before;
  if (!(fresh > 0)) return { kind: 'none', count: 0 };
  if (reducedMotion || fresh > MAX_DROP) return { kind: 'highlight', count: fresh };
  return { kind: 'drop', count: fresh };
}

/** The new books: the newest `count` of the stack's `total` (oldest first), as [start, end) indexes. */
export function newBooks(total: number, count: number): { start: number; end: number } {
  const end = Math.max(0, Math.floor(total));
  return { start: Math.max(0, end - Math.max(0, Math.floor(count))), end };
}

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * One visit's bookkeeping. `open` decides the arrival; the count is written straight away when
 * nothing falls (first visit, nothing new, highlight), and otherwise when the drop ends, when the
 * reader leaves the screen or when the page is hidden (so an interrupted drop doesn't replay).
 * Each of those records the pile as it is then (live updates included).
 */
export class SeenTracker {
  private recorded = false;

  constructor(
    private readonly storage: SeenStorage | null,
    private readonly readerId: string,
  ) {}

  private read(): Seen {
    try {
      return parseSeen(this.storage?.getItem(seenKey(this.readerId)) ?? null);
    } catch {
      return null;
    }
  }

  private write(total: number): void {
    try {
      this.storage?.setItem(seenKey(this.readerId), String(Math.max(0, Math.floor(total))));
    } catch {
      // No storage: this visit's books fall again next time.
    }
  }

  open(total: number, reducedMotion: boolean): Arrival {
    const result = arrival(total, this.read(), reducedMotion);
    if (result.kind !== 'drop') this.record(total);
    else this.recorded = false;
    return result;
  }

  /** The drop finished, the reader left, or the page was hidden: they've seen the pile as it is. */
  record(total: number): void {
    this.recorded = true;
    this.write(total);
  }

  /** Whether the count has been written since the drop started (for tests). */
  get done(): boolean {
    return this.recorded;
  }
}

/** Developer tools' "Pretend I've been away": the reader's count back by `n` (before a first visit: n behind the pile at the next visit). */
export function pretendAway(storage: SeenStorage, readerId: string, n: number): void {
  const by = Math.max(0, Math.floor(n));
  const now = parseSeen(storage.getItem(seenKey(readerId)));
  if (now && 'seen' in now) storage.setItem(seenKey(readerId), String(Math.max(0, now.seen - by)));
  else storage.setItem(seenKey(readerId), `-${by + (now && 'behind' in now ? now.behind : 0)}`);
}
