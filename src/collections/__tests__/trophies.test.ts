import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, getDataStore } from '../../data';
import { markAllCompletionsCelebrated } from '../../journeys/celebration';
import { earnedTrophies, getTrophiesCelebrated, markTrophyCelebrated, trophyKey } from '../trophies';

// The collection trophy: earned from confirmed reads, celebrated once per reader and set on this
// device, seeded with the journeys' list so nothing old replays. (No window here: the list lives
// in memory, as it does when storage is blocked.)

describe('collection trophies', () => {
  it('earned with every number read (confirmed), lost again by an undo; seeding marks what exists', async () => {
    const store = await getDataStore();
    await store.getCurrentHousehold();
    const ada = await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Ada', avatar: '🦊' });
    const box = await store.createCollection({ household_id: HOUSEHOLD_ID, title: 'Box', expected_count: 2 });
    for (const [isbn, volume] of [['9780000000002', 1], ['9780000000019', 2]] as const) {
      await store.putBook({ isbn, title: `Vol ${volume}`, authors: [], cover_url: null, source: 'manual' });
      await store.setBookCollection(isbn, box.id, volume);
    }

    await store.markRead(ada.id, '9780000000002', '2026-01-01T00:00:00Z');
    const waiting = await store.markRead(ada.id, '9780000000019', '2026-01-02T00:00:00Z', { how: 'self', status: 'pending' });
    expect(await earnedTrophies(store, ada.id)).toEqual([]); // the last read waits for a grown-up

    await store.confirmRead(waiting!.id, 'pin');
    expect(await earnedTrophies(store, ada.id)).toEqual([{ key: trophyKey(ada.id, box.id), collectionId: box.id, title: 'Box' }]);

    // Not on the list yet: it would celebrate. Celebrated once, it never shows again.
    expect(getTrophiesCelebrated()?.has(trophyKey(ada.id, box.id)) ?? false).toBe(false);
    markTrophyCelebrated(trophyKey(ada.id, box.id));
    expect(getTrophiesCelebrated()?.has(trophyKey(ada.id, box.id))).toBe(true);

    // Undo the last read: locked again (and earning it again won't replay it).
    await store.undoLatestRead(ada.id, '9780000000019');
    expect(await earnedTrophies(store, ada.id)).toEqual([]);

    // Seeding (start / join / replace / restore) puts every trophy held now on the list.
    const ben = await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Ben', avatar: '🐢' });
    await store.markRead(ben.id, '9780000000002', '2026-01-03T00:00:00Z');
    await store.markRead(ben.id, '9780000000019', '2026-01-04T00:00:00Z');
    expect(getTrophiesCelebrated()?.has(trophyKey(ben.id, box.id)) ?? false).toBe(false);
    await markAllCompletionsCelebrated(store);
    expect(getTrophiesCelebrated()?.has(trophyKey(ben.id, box.id))).toBe(true);
  });
});
