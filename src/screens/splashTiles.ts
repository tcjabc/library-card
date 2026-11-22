import type { Reader, ReaderKind } from '../data';

/**
 * The reader tiles on the splash. A child's tile opens the card scanner (children sign in with
 * their library card); a grown-up's tile signs them in at once. Pure, so it is unit-tested.
 */

export interface SplashTile {
  reader: Reader;
  kind: ReaderKind;
  /** "card": tap opens the card scanner. "tap": tap signs in. */
  signIn: 'card' | 'tap';
}

/** A reader's kind; anything else (an older row, a missing field) is a child. */
export function readerKind(reader: { kind?: unknown }): ReaderKind {
  return reader.kind === 'grown_up' ? 'grown_up' : 'child';
}

/** Children first, then grown-ups; by name within each (then id, so the order never jumps). */
export function splashTiles(readers: readonly Reader[]): SplashTile[] {
  return readers
    .map((reader) => {
      const kind = readerKind(reader);
      return { reader, kind, signIn: kind === 'grown_up' ? ('tap' as const) : ('card' as const) };
    })
    .sort(
      (a, b) =>
        Number(a.kind === 'grown_up') - Number(b.kind === 'grown_up') ||
        a.reader.display_name.localeCompare(b.reader.display_name, undefined, { sensitivity: 'base' }) ||
        a.reader.id.localeCompare(b.reader.id),
    );
}
