/**
 * The Family Staircase: every first read in the household is one step, oldest
 * at the bottom. Pure helpers (unit-tested): step order, where each reader's
 * avatar stands, milestone flags, the decorations ("novelties") and which
 * steps are on screen.
 */

export interface StairRead {
  reader_id: string;
  isbn: string;
  first_read_at: string;
}

/** Steps oldest first (step 1 = index 0): by first_read_at, then reader id, then isbn. */
export function staircaseOrder<T extends StairRead>(reads: readonly T[]): T[] {
  return [...reads].sort(
    (a, b) =>
      a.first_read_at.localeCompare(b.first_read_at) ||
      a.reader_id.localeCompare(b.reader_id) ||
      a.isbn.localeCompare(b.isbn),
  );
}

/** reader id -> the step (1-based) of that reader's latest first read. */
export function avatarSteps(stairs: readonly StairRead[]): Map<string, number> {
  const out = new Map<string, number>();
  stairs.forEach((read, i) => out.set(read.reader_id, i + 1));
  return out;
}

/** Milestone steps: 10, 25, 50, 100, then every 100. */
export function isMilestone(step: number): boolean {
  if (!Number.isInteger(step) || step < 1) return false;
  if (step === 10 || step === 25 || step === 50) return true;
  return step % 100 === 0;
}

/** 32-bit FNV-1a: small, fast and the same on every device. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** About one step in this many gets a novelty. */
export const NOVELTY_EVERY = 4;

/**
 * Which novelty (an index into the novelty list) sits beside each step, or
 * null. Seeded by household id + step, so the staircase looks the same on
 * every load and every device, and adding steps never moves earlier ones.
 * Two placed novelties in a row are never the same one.
 */
export function placeNovelties(householdId: string, steps: number, noveltyCount: number): (number | null)[] {
  const out: (number | null)[] = [];
  let previous: number | null = null;
  for (let step = 1; step <= steps; step++) {
    if (noveltyCount < 1 || hashString(`${householdId}|step|${step}`) % NOVELTY_EVERY !== 0) {
      out.push(null);
      continue;
    }
    let pick = hashString(`${householdId}|novelty|${step}`) % noveltyCount;
    if (pick === previous && noveltyCount > 1) pick = (pick + 1) % noveltyCount;
    out.push(pick);
    previous = pick;
  }
  return out;
}

/** A stable colour slot (0-based) for a reader, from their id. */
export function readerColorIndex(readerId: string, paletteSize: number): number {
  return paletteSize > 0 ? hashString(readerId) % paletteSize : 0;
}

/**
 * Colour slots (0-based) for a household's readers: each reader prefers the
 * slot from their id; when two collide, the later id (in sorted order) takes
 * the next free slot. Distinct for up to `paletteSize` readers.
 */
export function assignReaderColors(readerIds: readonly string[], paletteSize: number): Map<string, number> {
  const out = new Map<string, number>();
  if (paletteSize < 1) return out;
  const taken = new Set<number>();
  for (const id of [...new Set(readerIds)].sort()) {
    let slot = readerColorIndex(id, paletteSize);
    if (taken.size < paletteSize) while (taken.has(slot)) slot = (slot + 1) % paletteSize;
    taken.add(slot);
    out.set(id, slot);
  }
  return out;
}

export interface WindowInput {
  /** How far the list has scrolled past its own top, in px (may be negative). */
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  count: number;
  /** Extra items rendered above and below the visible ones. */
  buffer: number;
}

/** Items to render, as [start, end) indexes from the top of the list. */
export function visibleWindow({ scrollTop, viewportHeight, itemHeight, count, buffer }: WindowInput): {
  start: number;
  end: number;
} {
  if (count <= 0 || itemHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / itemHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / itemHeight);
  return { start: Math.max(0, Math.min(count, first - buffer)), end: Math.max(0, Math.min(count, last + buffer)) };
}

/** The decorations, in a fixed order (labels in en.ts). Don't reorder: placement uses the index. */
export const NOVELTIES = [
  { id: 'bird', emoji: '🐦' },
  { id: 'kite', emoji: '🪁' },
  { id: 'cloudCastle', emoji: '🏰' },
  { id: 'balloon', emoji: '🎈' },
  { id: 'dragon', emoji: '🐉' },
  { id: 'lighthouse', emoji: '🗼' },
  { id: 'rainbow', emoji: '🌈' },
  { id: 'plane', emoji: '✈️' },
  { id: 'star', emoji: '⭐' },
  { id: 'moon', emoji: '🌙' },
] as const;
