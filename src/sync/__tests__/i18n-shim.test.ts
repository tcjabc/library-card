import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../../strings';
import { KEYS, t } from '../vendor/i18n.js';

/** The stand-in for Peek Budget's i18n.js used by the vendored words.js and crypto.js. */

afterEach(() => vi.restoreAllMocks());

describe('vendor i18n shim', () => {
  it('maps every key to a text in strings.sync', () => {
    const names = Object.values(KEYS);
    expect(names.length).toBe(7);
    for (const name of names) expect(strings.sync[name as keyof typeof strings.sync]).toBeTruthy();
    expect(Object.keys(strings.sync).sort()).toEqual([...names].sort());
  });

  it('fills in placeholders and leaves unknown ones as they are', () => {
    expect(t('sync.words.error.count', { count: 11 })).toBe('There are 12 recovery words. You entered 11.');
    expect(t('sync.words.error.unknownNear', { n: 5, word: 'zooo', near: 'zoo' })).toBe('Word 5 ("zooo") isn\'t in the list. Did you mean "zoo"?');
    expect(t('sync.words.error.unknown', { n: 2 })).toBe('Word 2 ("{word}") isn\'t in the list.');
    expect(t('sync.key.invalid')).toBe('That household key is not valid.');
  });

  it('an unknown key gives an empty text and one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('sync.nope')).toBe('');
    expect(t('sync.nope')).toBe('');
    expect(t('toString')).toBe('');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
