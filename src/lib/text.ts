// Minor words stay lowercase in a title unless they start or end it.
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'or', 'over', 'the', 'to', 'up', 'with',
]);

/** True if the text has Latin letters and none of them are uppercase. */
export function isAllLowercase(text: string): boolean {
  return /[a-z]/.test(text) && text === text.toLowerCase();
}

/**
 * Title-cases English-style titles: "charlotte's web" -> "Charlotte's Web".
 * Words after a colon are always capitalised. Non-Latin text is unchanged.
 */
export function toTitleCase(text: string): string {
  const words = text.trim().split(/(\s+)/);
  const wordIndexes = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0];
  const last = wordIndexes[wordIndexes.length - 1];
  let afterColon = false;

  return words
    .map((word, i) => {
      if (!/\S/.test(word)) return word;
      const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
      const keepLower = MINOR_WORDS.has(bare) && i !== first && i !== last && !afterColon;
      afterColon = /[:—–]$/.test(word);
      if (keepLower) return word;
      // Capitalise each hyphen-separated part; leave letters after an apostrophe alone.
      return word.replace(/(^|-)([^\p{L}]*)(\p{L})/gu, (_m, sep: string, lead: string, ch: string) => sep + lead + ch.toUpperCase());
    })
    .join('');
}

/** Title-cases only when the text arrived entirely lowercase; otherwise returns it as is. */
export function fixLowercaseTitle(text: string): string {
  return isAllLowercase(text) ? toTitleCase(text) : text;
}
