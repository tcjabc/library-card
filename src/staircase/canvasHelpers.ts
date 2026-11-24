/** Small pure helpers for the canvas book stack (CanvasStack.tsx), unit-tested. */

/** The canvas draws at the screen's pixel ratio, but never more than 2x (sharp enough, a quarter of 4x's pixels). */
export const MAX_CANVAS_SCALE = 2;

export function canvasScale(devicePixelRatio: number): number {
  return devicePixelRatio > 0 ? Math.min(devicePixelRatio, MAX_CANVAS_SCALE) : 1;
}

/** A canvas's backing size (whole pixels, at least 1) for a CSS size at a scale. */
export function backingSize(cssPx: number, scale: number): number {
  return Math.max(1, Math.round(Math.max(0, cssPx) * scale));
}

/** A CSS length from a custom property ("0.625rem", "2px", "14") in px; NaN if it can't be read. */
export function cssLength(value: string, remPx: number): number {
  const m = /^\s*(-?[\d.]+)\s*(px|rem)?\s*$/.exec(value);
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  return m[2] === 'rem' ? n * remPx : n;
}

/** A string's characters as the reader sees them (an emoji or a CJK character is one), never half a pair. */
export function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  return Array.from(text);
}

export const ELLIPSIS = '…';

/**
 * The longest start of `text` that fits `maxWidth` with an ellipsis after it, or all of `text`
 * if it fits. Cuts only between whole characters and drops trailing spaces before the ellipsis.
 * `measure` gives a string's width (the canvas's measureText).
 */
export function fitWithEllipsis(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  if (measure(ELLIPSIS) > maxWidth) return '';
  const chars = graphemes(text);
  let lo = 0;
  let hi = chars.length - 1;
  // Binary search: the most characters that still fit with the ellipsis.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + ELLIPSIS;
}

/**
 * A small least-recently-used cache: getting or setting a key makes it the newest; the oldest goes
 * first. `onEvict` hears about every value that leaves (dropped, replaced, deleted or cleared), so
 * it can be released (e.g. an ImageBitmap closed).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private max: number;
  private readonly onEvict?: (value: V, key: K) => void;

  constructor(limit: number, onEvict?: (value: V, key: K) => void) {
    this.max = Math.max(1, Math.floor(limit));
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get limit(): number {
    return this.max;
  }

  /** A new limit (at least 1); a smaller one drops the oldest entries straight away. */
  resize(limit: number): void {
    this.max = Math.max(1, Math.floor(limit));
    this.trim();
  }

  private trim(): void {
    while (this.map.size > this.max) this.delete(this.map.keys().next().value as K);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const old = this.map.get(key);
    this.map.delete(key);
    if (old !== undefined && old !== value) this.onEvict?.(old, key);
    this.map.set(key, value);
    this.trim();
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Removes a key (its value is evicted). */
  delete(key: K): boolean {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    this.onEvict?.(value, key);
    return true;
  }

  /** The keys, oldest first. */
  keys(): K[] {
    return [...this.map.keys()];
  }

  clear(): void {
    const all = [...this.map];
    this.map.clear();
    if (this.onEvict) for (const [key, value] of all) this.onEvict(value, key);
  }
}
