import { describe, expect, it } from 'vitest';
import type { Reader } from '../../data';
import { readerKind, splashTiles } from '../splashTiles';

// The splash's reader tiles (src/screens/splashTiles.ts).

const reader = (id: string, display_name: string, kind?: string): Reader =>
  ({ id, household_id: 'main', display_name, avatar: '🦊', card_token: `tok-${id}`, active_journey_id: null, ...(kind === undefined ? {} : { kind }) }) as Reader;

describe('readerKind', () => {
  it('is a grown-up only when it says so; missing, null or unknown is a child', () => {
    expect(readerKind({ kind: 'grown_up' })).toBe('grown_up');
    expect(readerKind({ kind: 'child' })).toBe('child');
    expect(readerKind({})).toBe('child');
    expect(readerKind({ kind: null })).toBe('child');
    expect(readerKind({ kind: 'teacher' })).toBe('child');
  });
});

describe('splashTiles', () => {
  it('children first, then grown-ups, by name within each', () => {
    const tiles = splashTiles([
      reader('1', 'Mum', 'grown_up'),
      reader('2', 'zoe', 'child'),
      reader('3', 'Dad', 'grown_up'),
      reader('4', 'Ada'),
      reader('5', 'Ben', 'child'),
    ]);
    expect(tiles.map((t) => t.reader.display_name)).toEqual(['Ada', 'Ben', 'zoe', 'Dad', 'Mum']);
  });

  it('a child scans their card; a grown-up taps', () => {
    const tiles = splashTiles([reader('1', 'Ada'), reader('2', 'Mum', 'grown_up')]);
    expect(tiles.map((t) => [t.kind, t.signIn])).toEqual([
      ['child', 'card'],
      ['grown_up', 'tap'],
    ]);
  });

  it('the same name keeps a fixed order (by id), and no readers means no tiles', () => {
    expect(splashTiles([reader('b', 'Sam'), reader('a', 'Sam')]).map((t) => t.reader.id)).toEqual(['a', 'b']);
    expect(splashTiles([])).toEqual([]);
  });
});
