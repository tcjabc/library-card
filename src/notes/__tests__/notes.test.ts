import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOUSEHOLD_ID, getDataStore, noteViewId } from '../../data';
import { dueNote, firstReadMoments, journeyMoments, type ReaderNote } from '../due';
import { GUARD_MS, isGuarded, markShown, pruneGuard } from '../guard';

// Parent notes: which one is due (target, trigger, order, seen), first reads only, journeys,
// show again, and the per-device guard.

const note = (id: string, trigger: 'after_book' | 'journey_done', position: number, created_at = '2026-01-01T00:00:00.000Z', seen_at: string | null = null): ReaderNote => ({
  note: { id, trigger, position, created_at },
  seen_at,
});
const read = (isbn: string, read_at: string, status: 'pending' | 'confirmed' = 'confirmed', confirmed_at: string | null = null) => ({
  isbn,
  read_at,
  status,
  confirmed_at,
});

describe('first reads only', () => {
  it('one moment per book: its first confirmed read (when it was confirmed); re-reads and pending reads never count', () => {
    const moments = firstReadMoments([
      read('a', '2026-02-01T00:00:00.000Z', 'confirmed', '2026-02-01T00:00:00.000Z'),
      read('a', '2026-02-05T00:00:00.000Z'), // a re-read
      read('b', '2026-02-02T00:00:00.000Z', 'pending'), // waiting: not yet
      read('c', '2026-02-03T00:00:00.000Z', 'confirmed', '2026-02-09T00:00:00.000Z'), // confirmed later: counts from then
    ]);
    expect(moments.sort()).toEqual(['2026-02-01T00:00:00.000Z', '2026-02-09T00:00:00.000Z']);
  });

  it('a book read before (confirmed) and again (waiting, then confirmed) never counts again', () => {
    expect(firstReadMoments([read('a', '2026-02-01T00:00:00.000Z'), read('a', '2026-03-01T00:00:00.000Z', 'confirmed', '2026-03-02T00:00:00.000Z')])).toEqual([
      '2026-02-01T00:00:00.000Z',
    ]);
  });

  it('journeys: finished ones only', () => {
    expect(
      journeyMoments([
        { completed_at: '2026-03-01T00:00:00.000Z', abandoned_at: null },
        { completed_at: null, abandoned_at: null },
        { completed_at: null, abandoned_at: '2026-02-01T00:00:00.000Z' },
      ]),
    ).toEqual(['2026-03-01T00:00:00.000Z']);
  });
});

describe('which note is due', () => {
  const none = { after_book: [], journey_done: [] };

  it('nothing earned: nothing due; a new first read after the note was written: the lowest-placed unseen one', () => {
    const notes = [note('n2', 'after_book', 2), note('n1', 'after_book', 1), note('j', 'journey_done', 3)];
    expect(dueNote(notes, none)).toBeNull();
    expect(dueNote(notes, { ...none, after_book: ['2025-12-31T00:00:00.000Z'] })).toBeNull(); // before the notes existed
    expect(dueNote(notes, { ...none, after_book: ['2026-02-01T00:00:00.000Z'] })?.note.id).toBe('n1');
  });

  it('one at a time: seeing a note needs a new first read for the next one', () => {
    const seen = [note('n1', 'after_book', 1, undefined, '2026-02-02T00:00:00.000Z'), note('n2', 'after_book', 2)];
    expect(dueNote(seen, { ...none, after_book: ['2026-02-01T00:00:00.000Z'] })).toBeNull(); // the read that earned n1
    expect(dueNote(seen, { ...none, after_book: ['2026-02-01T00:00:00.000Z', '2026-02-03T00:00:00.000Z'] })?.note.id).toBe('n2');
    // All seen: nothing.
    expect(dueNote([note('n1', 'after_book', 1, undefined, '2026-02-02T00:00:00.000Z')], { ...none, after_book: ['2026-03-01T00:00:00.000Z'] })).toBeNull();
  });

  it('the journey note comes first (after its celebration), and only after a finished journey', () => {
    const notes = [note('b', 'after_book', 1), note('j', 'journey_done', 2)];
    const moments = { after_book: ['2026-02-01T00:00:00.000Z'], journey_done: ['2026-02-01T00:00:00.000Z'] };
    expect(dueNote(notes, moments)?.note.id).toBe('j');
    expect(dueNote(notes, { ...moments, journey_done: [] })?.note.id).toBe('b');
    expect(dueNote([note('j', 'journey_done', 1)], { ...none, after_book: ['2026-02-01T00:00:00.000Z'] })).toBeNull(); // a book doesn't earn a journey note
  });

  it('show again: the note is unseen again, and shows after the next new first read', () => {
    // n1 seen, then shown again (its record gone); n2 seen later.
    const notes = [note('n1', 'after_book', 1), note('n2', 'after_book', 2, undefined, '2026-03-01T00:00:00.000Z')];
    expect(dueNote(notes, { ...none, after_book: ['2026-02-15T00:00:00.000Z'] })).toBeNull();
    expect(dueNote(notes, { ...none, after_book: ['2026-03-05T00:00:00.000Z'] })?.note.id).toBe('n1');
  });
});

describe('the store and the rules together', () => {
  it('a pending first read earns nothing until confirmed; a re-read earns nothing; markNoteSeen moves on', async () => {
    const store = await getDataStore();
    await store.getCurrentHousehold();
    const kid = await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Kid', avatar: '🦊' });
    await store.markRead(kid.id, '9780000000002', '2025-01-01T00:00:00Z'); // read long before the note
    const n1 = await store.createNote({ household_id: HOUSEHOLD_ID, target: 'everyone', trigger: 'after_book', text: 'Well done!' });
    const n2 = await store.createNote({ household_id: HOUSEHOLD_ID, target: kid.id, trigger: 'after_book', text: 'Again!' });
    const due = async () => {
      const [notes, events] = await Promise.all([store.listNotesForReader(kid.id), store.listReadEvents(kid.id)]);
      return dueNote(notes, { after_book: firstReadMoments(events), journey_done: [] })?.note.id ?? null;
    };
    expect(await due()).toBeNull();
    await store.markRead(kid.id, '9780000000002', new Date(Date.now() + 1000).toISOString()); // a re-read
    expect(await due()).toBeNull();
    const pending = await store.markRead(kid.id, '9780000000019', new Date(Date.now() + 2000).toISOString(), { how: 'self', status: 'pending' });
    expect(await due()).toBeNull(); // waiting for a grown-up
    await store.confirmRead(pending!.id, 'pin');
    expect(await due()).toBe(n1.id);
    await store.markNoteSeen(n1.id, kid.id);
    expect(await due()).toBeNull(); // n2 needs another new book
    await store.markRead(kid.id, '9780000000026', new Date(Date.now() + 60_000).toISOString());
    expect(await due()).toBe(n2.id);
  });
});

describe('the per-device guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds a just-thanked note back until its record is here (or 10 minutes pass); then "Show again" works', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
    });
    const key = noteViewId('n1', 'kid');
    markShown(key, 1_000);
    expect(isGuarded(key, 2_000)).toBe(true);
    expect(isGuarded(key, 1_000 + GUARD_MS)).toBe(false);
    pruneGuard(new Set(), 2_000);
    expect(isGuarded(key, 3_000)).toBe(true); // its record hasn't arrived yet
    pruneGuard(new Set([key]), 3_000);
    expect(isGuarded(key, 4_000)).toBe(false); // it has: the guard lets go
    expect([...data.keys()].every((k) => k.startsWith('library-card:'))).toBe(true);
  });
});
