import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, getDataStore, type ReadEvent } from '../../data';
import { summarize } from '../../data/readRules';
import { checkJourneyCompletion } from '../../journeys/completion';
import { journeyProgress } from '../../journeys/progress';

// Reads checked by a grown-up: the counting rules, and a journey finished by a confirmation.

const event = (id: string, read_at: string, status: ReadEvent['status']): ReadEvent => ({
  id,
  household_id: HOUSEHOLD_ID,
  reader_id: 'ada',
  isbn: 'b1',
  read_at,
  how: 'self',
  status,
  confirmed_at: null,
  confirmed_by: null,
});

describe('counting rules', () => {
  it('a pending read never counts', () => {
    expect(summarize([event('1', '2026-01-01T00:00:00Z', 'pending')])).toBeNull();
    const mixed = summarize([event('1', '2026-01-01T00:00:00Z', 'pending'), event('2', '2026-01-03T00:00:00Z', 'confirmed')]);
    expect([mixed?.count, mixed?.first_read_at]).toEqual([1, '2026-01-03T00:00:00Z']);
  });

  it('confirmed, it counts from when the child read it (so an earlier read becomes the first)', () => {
    const later = summarize([event('1', '2026-01-01T00:00:00Z', 'confirmed'), event('2', '2026-01-03T00:00:00Z', 'confirmed')]);
    expect([later?.count, later?.first_read_at, later?.last_read_at]).toEqual([2, '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']);
    // A journey started on the 2nd counts the book only if its first confirmed read is on or after then.
    expect(journeyProgress([later!], '2026-01-02T00:00:00Z', 5)).toBe(0);
    expect(journeyProgress([later!], '2025-12-31T00:00:00Z', 5)).toBe(1);
  });

  it('older events (no status) count, as before', () => {
    const old = { ...event('1', '2026-01-01T00:00:00Z', 'confirmed') } as Partial<ReadEvent>;
    delete old.status;
    expect(summarize([old as ReadEvent])?.count).toBe(1);
  });
});

describe('a journey finished by a confirmation', () => {
  it('completes when the grown-up confirms the last read, not when the child sends it; "Not yet" never completes it', async () => {
    // This file's own in-memory database (each test file gets a fresh fake IndexedDB).
    const store = await getDataStore();
    const h = await store.getCurrentHousehold();
    const child = await store.createReader({ household_id: h.id, display_name: 'Ada', avatar: '🦊' });
    const mum = await store.createReader({ household_id: h.id, display_name: 'Mum', avatar: '🦉', kind: 'grown_up' });
    await store.startJourney(child.id, 'ocean_deep', '2026-01-01T00:00:00Z'); // 5 books
    for (let i = 0; i < 4; i++) await store.markRead(child.id, `978000000000${i}`, `2026-01-0${i + 2}T00:00:00Z`, { how: 'self', confirmedBy: 'pin' });
    const sent = await store.markRead(child.id, '9780000000099', '2026-01-08T00:00:00Z', { how: 'help', status: 'pending' });
    expect(await checkJourneyCompletion(store, child.id)).toBeNull();

    // "Not yet": still four.
    await store.rejectRead(sent!.id);
    expect(await checkJourneyCompletion(store, child.id)).toBeNull();

    const again = await store.markRead(child.id, '9780000000099', '2026-01-09T00:00:00Z', { how: 'self', status: 'pending' });
    expect(await checkJourneyCompletion(store, child.id)).toBeNull();
    await store.confirmRead(again!.id, mum.id);
    const done = await checkJourneyCompletion(store, child.id);
    expect(done?.journey_id).toBe('ocean_deep');
    expect(done?.completed_at).not.toBeNull();
    // The celebration follows from the completion (journeys/celebration.ts) next time Ada is active.
    expect((await store.listJourneyHistory(child.id))[0]?.completed_at).toBe(done?.completed_at);
  });
});
