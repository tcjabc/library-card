import { WORDLIST } from '../../sync/vendor/wordlist.js';
import { closestWord, splitWords, WORD_COUNT } from '../../sync/vendor/words.js';

/**
 * The logic of the 12-word input (pure, so it is unit-tested): normalising
 * what was typed, spreading a pasted list across the boxes, and checking each
 * word against the BIP-39 list. The checksum is checked by parseRecovery.
 */

export { WORD_COUNT };

const KNOWN = new Set(WORDLIST);

export type WordCheck =
  | { status: 'empty' }
  | { status: 'ok' }
  /** Not in the list; `near` is the word they probably meant, if there is one. */
  | { status: 'unknown'; near: string | null };

export const emptyWords = (): string[] => Array.from({ length: WORD_COUNT }, () => '');

/** One box's text as stored: lowercase letters only. */
export const cleanWord = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Typing or pasting into box `index`. A single word just replaces that box;
 * several (a pasted list, "1. abandon 2. ability…", or a typed space) fill
 * that box and the ones after it. Returns the new words and the box to focus.
 */
export function enterText(words: readonly string[], index: number, text: string): { words: string[]; focus: number } {
  const next = [...words];
  const parts = splitWords(text);
  const trailingSpace = /\s$/.test(text);
  if (parts.length <= 1) {
    next[index] = cleanWord(parts[0] ?? '');
    // A typed space after a word moves on to the next box.
    return { words: next, focus: trailingSpace && next[index] ? Math.min(index + 1, WORD_COUNT - 1) : index };
  }
  let i = index;
  for (const part of parts) {
    if (i >= WORD_COUNT) break;
    next[i++] = part;
  }
  return { words: next, focus: Math.min(i, WORD_COUNT - 1) };
}

export function checkWord(word: string): WordCheck {
  if (!word) return { status: 'empty' };
  if (KNOWN.has(word)) return { status: 'ok' };
  return { status: 'unknown', near: closestWord(word) };
}

/** All 12 boxes hold list words: ready for the checksum check. */
export const allWordsKnown = (words: readonly string[]): boolean =>
  words.length === WORD_COUNT && words.every((w) => checkWord(w).status === 'ok');

/** Up to `limit` list words starting with what was typed (for the suggestions). */
export function suggestions(prefix: string, limit = 4): string[] {
  const p = cleanWord(prefix);
  if (!p || KNOWN.has(p)) return [];
  const out: string[] = [];
  for (const w of WORDLIST) {
    if (w.startsWith(p)) out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}
