import { describe, expect, it } from 'vitest';
import { isAppStorageKey } from '../../grownups/helpers';
import { STACK_SOUNDS_KEY } from '../soundSetting';
import { MAX_DROP, SEEN_PREFIX, SeenTracker, arrival, newBooks, parseSeen, pretendAway, seenKey, type SeenStorage } from '../stackSeen';

// "Since your last visit" on the Family Staircase (src/staircase/stackSeen.ts).

function memory(): SeenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('the stored count', () => {
  it('is kept per reader under the app’s prefix, so "Reset this device" clears it (as it does the sound switch)', () => {
    expect(seenKey('kid-1')).toBe('library-card:stack-seen:kid-1');
    expect(SEEN_PREFIX.startsWith('library-card:')).toBe(true);
    expect(isAppStorageKey(seenKey('kid-1'))).toBe(true);
    expect(isAppStorageKey(STACK_SOUNDS_KEY)).toBe(true);
  });

  it('reads a count, a "behind" request, or nothing usable', () => {
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen('12')).toEqual({ seen: 12 });
    expect(parseSeen('0')).toEqual({ seen: 0 });
    expect(parseSeen('-5')).toEqual({ behind: 5 });
    expect(parseSeen('')).toBeNull();
    expect(parseSeen('abc')).toBeNull();
    expect(parseSeen('1.5')).toBeNull();
  });
});

describe('arrival: what falls when the screen opens', () => {
  it('first visit on this device: nothing falls', () => {
    expect(arrival(40, null, false)).toEqual({ kind: 'first', count: 0 });
  });

  it('nothing new, or the pile shrank: nothing falls', () => {
    expect(arrival(40, { seen: 40 }, false)).toEqual({ kind: 'none', count: 0 });
    expect(arrival(38, { seen: 40 }, false)).toEqual({ kind: 'none', count: 0 });
  });

  it('new books fall: the newest ones', () => {
    expect(arrival(43, { seen: 40 }, false)).toEqual({ kind: 'drop', count: 3 });
    expect(arrival(48, { seen: 40 }, false)).toEqual({ kind: 'drop', count: 8 });
    expect(arrival(49, { seen: 40 }, false)).toEqual({ kind: 'drop', count: 9 });
    expect(newBooks(43, 3)).toEqual({ start: 40, end: 43 });
    expect(newBooks(2, 5)).toEqual({ start: 0, end: 2 });
  });

  it('more than 40: shown in place with a highlight; exactly 40 still fall', () => {
    expect(MAX_DROP).toBe(40);
    expect(arrival(80, { seen: 40 }, false)).toEqual({ kind: 'drop', count: 40 });
    expect(arrival(81, { seen: 40 }, false)).toEqual({ kind: 'highlight', count: 41 });
  });

  it('reduced motion: nothing falls, the new books are highlighted', () => {
    expect(arrival(43, { seen: 40 }, true)).toEqual({ kind: 'highlight', count: 3 });
    expect(arrival(43, null, true)).toEqual({ kind: 'first', count: 0 });
  });

  it('"Pretend I’ve been away" before a first visit: that many behind the pile', () => {
    expect(arrival(40, { behind: 3 }, false)).toEqual({ kind: 'drop', count: 3 });
    expect(arrival(2, { behind: 5 }, false)).toEqual({ kind: 'drop', count: 2 });
  });
});

describe('when the count is written', () => {
  it('first visit, nothing new and highlights: straight away', () => {
    const store = memory();
    new SeenTracker(store, 'r').open(12, false);
    expect(store.data.get(seenKey('r'))).toBe('12');
    expect(new SeenTracker(store, 'r').open(12, false).kind).toBe('none');
    store.data.set(seenKey('r'), '2');
    expect(new SeenTracker(store, 'r').open(60, false).kind).toBe('highlight');
    expect(store.data.get(seenKey('r'))).toBe('60');
  });

  it('a drop: only when it ends, the reader leaves or the page is hidden (the pile as it is then)', () => {
    const store = memory();
    store.data.set(seenKey('r'), '10');
    const visit = new SeenTracker(store, 'r');
    expect(visit.open(13, false)).toEqual({ kind: 'drop', count: 3 });
    expect(store.data.get(seenKey('r'))).toBe('10');
    expect(visit.done).toBe(false);
    // Hidden half way (or the drop ends, or the reader leaves): recorded, with any live arrivals.
    visit.record(14);
    expect(store.data.get(seenKey('r'))).toBe('14');
    expect(visit.done).toBe(true);
    // The next visit has nothing new.
    expect(new SeenTracker(store, 'r').open(14, false).kind).toBe('none');
  });

  it('each reader has their own count', () => {
    const store = memory();
    store.data.set(seenKey('a'), '5');
    expect(new SeenTracker(store, 'a').open(8, false).count).toBe(3);
    expect(new SeenTracker(store, 'b').open(8, false).kind).toBe('first');
  });

  it('without storage nothing breaks (and nothing is remembered)', () => {
    const broken: SeenStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(new SeenTracker(broken, 'r').open(5, false).kind).toBe('first');
    expect(new SeenTracker(null, 'r').open(5, false).kind).toBe('first');
  });

  it('"Pretend I’ve been away" sets the count back (never below 0), or asks for that many next time', () => {
    const store = memory();
    store.data.set(seenKey('r'), '10');
    pretendAway(store, 'r', 3);
    expect(store.data.get(seenKey('r'))).toBe('7');
    pretendAway(store, 'r', 50);
    expect(store.data.get(seenKey('r'))).toBe('0');
    pretendAway(store, 'new', 4);
    expect(store.data.get(seenKey('new'))).toBe('-4');
    pretendAway(store, 'new', 2);
    expect(store.data.get(seenKey('new'))).toBe('-6');
  });
});
