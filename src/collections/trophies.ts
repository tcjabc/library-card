import { useSyncExternalStore } from 'react';
import { HOUSEHOLD_ID, type DataStore, type Id } from '../data';
import { loadCollections, progressOf } from './load';

/**
 * Which collection trophies ("Whole set read!") this device has already celebrated: a list of
 * "<reader id>:<collection id>", per device (localStorage; never synced or backed up, cleared by
 * "Reset this device"), like the journeys' list (src/journeys/celebration.ts).
 *
 * A trophy celebrates once per reader and set on this device, the next time the reader is active,
 * however it was earned (a read here, a grown-up's confirmation, another device). Losing it (an
 * undone read) and earning it again doesn't replay it. The list is seeded with every trophy that
 * already exists whenever the journeys' list is (first run, starting or joining sync, replacing
 * with the household's data, restoring a backup), so nothing old replays.
 */

const LIST_KEY = 'library-card:collections-celebrated';

let memory: string[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

export const trophyKey = (readerId: Id, collectionId: Id) => `${readerId}:${collectionId}`;

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

function writeRaw(keys: Iterable<string>): void {
  memory = [...new Set(keys)];
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(memory));
  } catch {
    // Keep the in-memory list.
  }
  version++;
  listeners.forEach((l) => l());
}

/** The celebrated trophies, or null before the list was ever made on this device. */
export function getTrophiesCelebrated(): Set<string> | null {
  const raw = readRaw();
  return raw === null ? null : new Set(raw);
}

export function markTrophyCelebrated(key: string): void {
  writeRaw([...(readRaw() ?? []), key]);
}

/** The collections whose trophy the reader holds now. */
export async function earnedTrophies(store: DataStore, readerId: Id): Promise<{ key: string; collectionId: Id; title: string }[]> {
  const [views, summaries] = await Promise.all([loadCollections(store, HOUSEHOLD_ID), store.listReadSummaries(readerId)]);
  const progress = progressOf(views, new Set(summaries.map((s) => s.isbn)));
  return views
    .filter((v) => progress.get(v.collection.id)?.trophy)
    .map((v) => ({ key: trophyKey(readerId, v.collection.id), collectionId: v.collection.id, title: v.collection.title }));
}

/** Every trophy held now goes on the list (seeding: see above). */
export async function markAllTrophiesCelebrated(store: DataStore): Promise<void> {
  const keys = new Set(readRaw() ?? []);
  for (const reader of await store.listReaders(HOUSEHOLD_ID)) {
    for (const t of await earnedTrophies(store, reader.id)) keys.add(t.key);
  }
  writeRaw(keys);
}

/** First run of this version on a device: make the list from the trophies already held. */
export async function ensureTrophyList(store: DataStore): Promise<void> {
  if (readRaw() === null) await markAllTrophiesCelebrated(store);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LIST_KEY || event.key === null) {
      memory = null;
      version++;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The list, kept current (this tab and others). */
export function useTrophyList(): Set<string> | null {
  const v = useSyncExternalStore(subscribe, () => version);
  void v;
  return getTrophiesCelebrated();
}
