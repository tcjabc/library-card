import type { Id, Library } from '../data';

/** How many characters of a sample sticker make a library's prefix. */
export const STICKER_PREFIX_LENGTH = 5;

/** A library's sticker prefix from one sample sticker: its first 5 characters. */
export function stickerPrefix(sample: string, length = STICKER_PREFIX_LENGTH): string {
  return sample.trim().slice(0, length);
}

export type LibraryChoiceReason = 'sticker' | 'only' | 'last' | 'none';

export interface LibraryChoice {
  library: Library | null;
  reason: LibraryChoiceReason;
}

/**
 * Which library a new loan is from:
 *   1. a library whose sticker_prefix the sticker starts with (longest prefix wins);
 *   2. the only library, if there is just one;
 *   3. the library used last on this device;
 *   4. none.
 */
export function chooseLibrary(
  libraries: readonly Library[],
  { sticker, lastUsedId }: { sticker?: string | null; lastUsedId?: Id | null } = {},
): LibraryChoice {
  const value = sticker?.trim();
  if (value) {
    const matches = libraries
      .filter((lib) => lib.sticker_prefix && value.startsWith(lib.sticker_prefix))
      .sort((a, b) => b.sticker_prefix!.length - a.sticker_prefix!.length);
    if (matches.length) return { library: matches[0], reason: 'sticker' };
  }
  if (libraries.length === 1) return { library: libraries[0], reason: 'only' };
  const last = lastUsedId ? libraries.find((lib) => lib.id === lastUsedId) : undefined;
  if (last) return { library: last, reason: 'last' };
  return { library: null, reason: 'none' };
}
