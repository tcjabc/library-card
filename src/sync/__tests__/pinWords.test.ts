import { describe, expect, it } from 'vitest';
import { wordsMatchKey } from '../service';
import { generateKey } from '../vendor/crypto.js';
import { keyToWords } from '../vendor/words.js';

// Forgot PIN with the 12 words: they must be this device's household (src/sync/service.ts).

describe('wordsMatchKey', () => {
  it('this household’s words pass, typed loosely too', async () => {
    const key = generateKey();
    const words = await keyToWords(key);
    expect(await wordsMatchKey(words.join(' '), key)).toBe(true);
    expect(await wordsMatchKey(`  ${words.join('   ').toUpperCase()} `, key)).toBe(true);
    expect(await wordsMatchKey(words.map((w, i) => `${i + 1}. ${w}`).join('\n'), key)).toBe(true);
    expect(await wordsMatchKey(key, key)).toBe(true); // the 22-character key form
  });

  it('another household’s words fail', async () => {
    const mine = generateKey();
    const theirs = generateKey();
    expect(await wordsMatchKey((await keyToWords(theirs)).join(' '), mine)).toBe(false);
  });

  it('wrong, missing, swapped or made-up words fail (never throws)', async () => {
    const key = generateKey();
    const words = await keyToWords(key);
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const oneWrong = [...words];
    oneWrong[5] = oneWrong[5] === 'abandon' ? 'ability' : 'abandon';
    for (const attempt of [
      words.slice(0, 11).join(' '),
      swapped.join(' '),
      oneWrong.join(' '),
      [...words.slice(0, 11), 'notaword'].join(' '),
      '',
      'hello',
    ]) {
      // A swap or one changed word can (rarely) still pass the checksum; it's then another key.
      expect(await wordsMatchKey(attempt, key)).toBe(false);
    }
  });
});
