import { LAUNCH_BOOKS } from './launchRule';

/**
 * The launch shelf's book colours (pure, unit-tested; docs/launch.md): the given colours first
 * (later: the household's real cover colours, e.g. the newest entries of the device's cover colour
 * cache run through coverColour.spineColours), the token palette for the rest. In 1.22.0 nothing is
 * given, so every book takes a token: --launch-book-1 … --launch-book-8, in an order where no two
 * neighbours share a colour.
 */

/** How many palette tokens there are (--launch-book-1 … -N). */
export const LAUNCH_PALETTE_SIZE = 8;

/** The token for palette entry `n` (1-based). */
export const launchBookToken = (n: number): string => `var(--launch-book-${n})`;

/** The palette entry (1-based) for book `index`: steps of 3 through 8 colours, so neighbours differ and all eight appear. */
export function fallbackEntry(index: number): number {
  return ((index * 3) % LAUNCH_PALETTE_SIZE) + 1;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * One CSS colour per book: `given` colours (hex `#rrggbb`; anything else is skipped) in order,
 * then tokens for the rest.
 */
export function launchBookColours(given: readonly string[] | null = null, count: number = LAUNCH_BOOKS): string[] {
  const real = (given ?? []).filter((colour) => HEX.test(colour)).map((colour) => colour.toLowerCase());
  return Array.from({ length: count }, (_, i) => (i < real.length ? real[i] : launchBookToken(fallbackEntry(i))));
}
