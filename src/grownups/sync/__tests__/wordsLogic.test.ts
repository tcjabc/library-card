import { describe, expect, it } from 'vitest';
import { looksLikePairingCode } from '../../../sync/pairingCode';
import { generateKey } from '../../../sync/vendor/crypto.js';
import { keyToWords, parseRecovery } from '../../../sync/vendor/words.js';
import { allWordsKnown, checkWord, cleanWord, emptyWords, enterText, suggestions } from '../wordsLogic';

/** The 12-word input's rules, and the card scanner's "grown-up code" check. */

describe('words input', () => {
  it('starts with 12 empty boxes', () => {
    expect(emptyWords()).toEqual(Array(12).fill(''));
  });

  it('keeps lowercase letters only', () => {
    expect(cleanWord(' Abandon1! ')).toBe('abandon');
  });

  it('one word fills one box; a typed space moves to the next', () => {
    expect(enterText(emptyWords(), 3, 'Zoo')).toEqual({ words: [...Array(3).fill(''), 'zoo', ...Array(8).fill('')], focus: 3 });
    expect(enterText(emptyWords(), 3, 'zoo ').focus).toBe(4);
    expect(enterText(emptyWords(), 11, 'zoo ').focus).toBe(11);
    expect(enterText(emptyWords(), 0, ' ').focus).toBe(0);
  });

  it('a pasted list (even numbered) fills from that box on, and stops at 12', async () => {
    const words = await keyToWords(generateKey());
    const numbered = words.map((w, i) => `${i + 1}. ${w}`).join('\n');
    expect(enterText(emptyWords(), 0, numbered)).toEqual({ words, focus: 11 });
    const fromFour = enterText(emptyWords(), 4, words.slice(0, 3).join(' '));
    expect(fromFour.words.slice(4, 7)).toEqual(words.slice(0, 3));
    expect(fromFour.focus).toBe(7);
    expect(enterText(emptyWords(), 10, words.join(' ')).words.slice(10)).toEqual(words.slice(0, 2));
  });

  it('checks each word against the list, with a likely word for typos', () => {
    expect(checkWord('')).toEqual({ status: 'empty' });
    expect(checkWord('abandon')).toEqual({ status: 'ok' });
    expect(checkWord('abandn')).toEqual({ status: 'unknown', near: 'abandon' });
    expect(checkWord('zzzzzzzz')).toEqual({ status: 'unknown', near: null });
  });

  it('is ready only when all 12 boxes hold list words; the checksum is checked after', async () => {
    const words = await keyToWords(generateKey());
    expect(allWordsKnown(words)).toBe(true);
    expect(allWordsKnown([...words.slice(0, 11), ''])).toBe(false);
    expect(allWordsKnown([...words.slice(0, 11), 'nope'])).toBe(false);
    const swapped = [words[1], words[0], ...words.slice(2)];
    if (swapped.join(' ') !== words.join(' ')) {
      expect(allWordsKnown(swapped)).toBe(true);
      // Two swapped words still look fine word by word; the checksum usually catches it.
      await parseRecovery(swapped.join(' ')).then(
        (key) => expect(key).not.toBe(''),
        (error: Error) => expect(error.message).toMatch(/wrong or out of order/),
      );
    }
  });

  it('suggests up to four list words for a beginning, none for a full word', () => {
    expect(suggestions('aba')).toEqual(['abandon']);
    expect(suggestions('ab')).toHaveLength(4);
    expect(suggestions('abandon')).toEqual([]);
    expect(suggestions('')).toEqual([]);
    expect(suggestions('qx')).toEqual([]);
  });
});

describe('pairing code on the card scanner', () => {
  it('12 words look like a grown-up code; card links and other text do not', async () => {
    expect(looksLikePairingCode((await keyToWords(generateKey())).join(' '))).toBe(true);
    expect(looksLikePairingCode('https://example.org/#/card/abc')).toBe(false);
    expect(looksLikePairingCode('abandon '.repeat(11).trim())).toBe(false);
    expect(looksLikePairingCode('9780000000002')).toBe(false);
  });
});
