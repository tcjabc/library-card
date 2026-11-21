import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../../strings';
import { KEYS, t } from '../vendor/i18n.js';

/** The stand-in for Peek Budget's i18n.js used by the vendored sync files. */

afterEach(() => vi.restoreAllMocks());

/** Dotted paths of every text in `node`; a { one, other } pair counts as one plural text. */
function textPaths(node: unknown, prefix: string): string[] {
  if (typeof node === 'string') return [prefix];
  const obj = node as Record<string, unknown>;
  if (typeof obj.other === 'string') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => textPaths(v, `${prefix}.${k}`));
}

describe('vendor i18n shim', () => {
  it('maps every key to a text, and every text in strings.sync has a key', () => {
    const paths = Object.values(KEYS);
    for (const [key, path] of Object.entries(KEYS)) {
      expect(t(key, { count: 2 }), key).not.toBe('');
      expect(path.startsWith('sync.') || path === 'common.cancel', key).toBe(true);
    }
    expect(textPaths(strings.sync, 'sync').sort()).toEqual(paths.filter((p) => p.startsWith('sync.')).sort());
  });

  it('fills in placeholders and leaves unknown ones as they are', () => {
    expect(t('sync.words.error.count', { count: 11 })).toBe('There are 12 recovery words. You entered 11.');
    expect(t('sync.words.error.unknownNear', { n: 5, word: 'zooo', near: 'zoo' })).toBe('Word 5 ("zooo") isn\'t in the list. Did you mean "zoo"?');
    expect(t('sync.words.error.unknown', { n: 2 })).toBe('Word 2 ("{word}") isn\'t in the list.');
    expect(t('sync.key.invalid')).toBe('That household key is not valid.');
    expect(t('sync.error.refused', { status: 418 })).toBe('The relay refused the request (418).');
    expect(t('common.cancel')).toBe(strings.common.cancel);
  });

  it('picks the plural form from {count}', () => {
    expect(t('sync.replace.message', { count: 1 })).toMatch(/^The 1 item on this device/);
    expect(t('sync.replace.message', { count: 3 })).toMatch(/^The 3 items on this device/);
    expect(t('sync.replace.message')).toMatch(/^The \{count\} items/);
  });

  it('keeps the texts the ported engine tests check', () => {
    expect(t('sync.join.noHousehold')).toBe('No household found for these words. Check them and try again.');
    expect(t('sync.needsWords')).toBe('Sync needs the 12 words on this device. Join again with your recovery words.');
    expect(t('sync.error.401')).toMatch(/household key/);
    expect(t('sync.error.429')).toMatch(/busy/);
    expect(t('sync.clockAhead')).toMatch(/clock/);
  });

  it('an unknown key gives an empty text and one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('sync.nope')).toBe('');
    expect(t('sync.nope')).toBe('');
    expect(t('toString')).toBe('');
    expect(t('sync.error')).toBe(''); // a group, not a text
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
