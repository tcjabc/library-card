import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Library } from '../../data';
import { getLastLibraryId, setLastLibraryId } from '../lastLibrary';
import { chooseLibrary, stickerPrefix } from '../sticker';

const lib = (id: string, sticker_prefix: string | null = null): Library => ({
  id,
  household_id: 'main',
  name: id,
  search_url_template: null,
  homepage_url: null,
  default_loan_days: 30,
  sticker_prefix,
});

describe('stickerPrefix', () => {
  it('is the first 5 characters of a sample, trimmed', () => {
    expect(stickerPrefix(' 31000123456789 ')).toBe('31000');
    expect(stickerPrefix('A12')).toBe('A12');
    expect(stickerPrefix('ABCDEFG', 3)).toBe('ABC');
  });
});

describe('chooseLibrary', () => {
  const west = lib('west', '31000');
  const east = lib('east', '31001');
  const plain = lib('plain');

  it('1. a sticker prefix match wins over everything else', () => {
    expect(chooseLibrary([west, east], { sticker: '31001999', lastUsedId: 'west' })).toEqual({ library: east, reason: 'sticker' });
  });

  it('the longest matching prefix wins', () => {
    const broad = lib('broad', '310');
    expect(chooseLibrary([broad, west], { sticker: '3100055' }).library?.id).toBe('west');
  });

  it('2. the only library, when the sticker does not match or is missing', () => {
    expect(chooseLibrary([west], { sticker: '99999' })).toEqual({ library: west, reason: 'only' });
    expect(chooseLibrary([plain])).toEqual({ library: plain, reason: 'only' });
  });

  it('3. the last used library', () => {
    expect(chooseLibrary([west, east], { sticker: null, lastUsedId: 'east' })).toEqual({ library: east, reason: 'last' });
  });

  it('4. none: several libraries, no match and no (or a deleted) last choice', () => {
    expect(chooseLibrary([west, east], { sticker: '77' })).toEqual({ library: null, reason: 'none' });
    expect(chooseLibrary([west, east], { lastUsedId: 'deleted' })).toEqual({ library: null, reason: 'none' });
    expect(chooseLibrary([])).toEqual({ library: null, reason: 'none' });
  });
});

describe('last-used library (localStorage)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers and forgets', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => data.set(k, v),
        removeItem: (k: string) => data.delete(k),
      },
    });
    expect(getLastLibraryId()).toBeNull();
    setLastLibraryId('west');
    expect(getLastLibraryId()).toBe('west');
    setLastLibraryId(null);
    expect(getLastLibraryId()).toBeNull();
  });

  it('copes with storage that throws', () => {
    const broken = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('window', { localStorage: { getItem: broken, setItem: broken, removeItem: broken } });
    expect(getLastLibraryId()).toBeNull();
    expect(() => setLastLibraryId('west')).not.toThrow();
  });
});
