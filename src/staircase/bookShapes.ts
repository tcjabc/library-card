/**
 * Books shaped like their covers (pure, unit-tested; every constant in one place). A book's
 * footprint, its spine length (W) and its depth (D), comes from its cover's shape, width ÷ height
 * = D / W, at a fixed area, so tall picture books, square books and wide landscape books look it.
 * Its thickness varies a little from a hash of the book (its ISBN, or no-ISBN key), never from the
 * cover: a cover arriving late changes only that book's footprint, never the pile's height.
 * The approved mock-up's defaults. Units are the stack's world units (px in the pile).
 */
import { bookShape, mixedHash, type BookShape } from './stackModel';

/** The standard book (no cover shape known): 190 × 124, as the mock-up's. */
export const STANDARD_WIDTH = 190;
export const STANDARD_DEPTH = 124;
/** The standard shape, depth over spine length (a cover's width over its height). */
export const REF_ASPECT = STANDARD_DEPTH / STANDARD_WIDTH;
/** Every footprint has the standard book's area… */
export const AREA = STANDARD_WIDTH * STANDARD_DEPTH;
/** …a usable cover shape is clamped to this range (narrower or wider ones are taken as these)… */
export const ASPECT_RANGE: readonly [number, number] = [0.45, 1.6];
/** …and the spine length to this (px). */
export const WIDTH_RANGE: readonly [number, number] = [120, 240];
/** How far the cover's shape pulls the footprint from the standard one: 0 none, 1 all the way. */
export const STRENGTH = 1;
/** The reference thickness (the mock-up's 28-unit book: also the gap's "book thickness"). */
export const THICKNESS = 28;
/** How much thicknesses vary: ± VARIETY × 0.45 of THICKNESS (0.865 to 1.135 × 28 at 0.3). */
export const VARIETY = 0.3;
const VARIETY_SPAN = 0.9;
/** The thickest and thinnest books can be. */
export const THICKEST = THICKNESS * (1 + VARIETY * 0.5 * VARIETY_SPAN);
export const THINNEST = THICKNESS * (1 - VARIETY * 0.5 * VARIETY_SPAN);
/** Caches of spine labels and page edges are kept per size bucket (px), not per exact size. */
export const WIDTH_BUCKET = 6;
export const THICKNESS_BUCKET = 0.5;

/** A cover's shape from its natural size (width ÷ height), clamped; null when the size is unusable (0, NaN, …). */
export function coverAspect(width: number, height: number): number | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const [lo, hi] = ASPECT_RANGE;
  return Math.min(hi, Math.max(lo, width / height));
}

/** A shape as used: clamped to the range, the standard shape when unknown. */
export function usableAspect(aspect: number | null | undefined): number {
  if (aspect === null || aspect === undefined || !Number.isFinite(aspect) || !(aspect > 0)) return REF_ASPECT;
  const [lo, hi] = ASPECT_RANGE;
  return Math.min(hi, Math.max(lo, aspect));
}

export interface Footprint {
  /** Spine length (px). */
  width: number;
  /** Front to back (px). */
  depth: number;
}

/**
 * The footprint for a cover's shape: eff = REF × (aspect / REF)^strength, W = clamp(√(AREA / eff),
 * WIDTH_RANGE), D = eff × W. Unknown covers get the standard 190 × 124.
 */
export function coverFootprint(aspect: number | null | undefined, strength = STRENGTH): Footprint {
  const a = usableAspect(aspect);
  const eff = REF_ASPECT * (a / REF_ASPECT) ** strength;
  const [lo, hi] = WIDTH_RANGE;
  const width = Math.min(hi, Math.max(lo, Math.sqrt(AREA / eff)));
  return { width, depth: eff * width };
}

/** A stable number in [0, 1) for a book (its ISBN or no-ISBN key): the same on every device. */
export function thicknessHash(bookKey: string): number {
  return mixedHash(`thickness|${bookKey}`) / 2 ** 32;
}

/** A book's thickness: THICKNESS × (1 + VARIETY × (hv − 0.5) × 0.9), hv its hash. */
export function bookThickness(bookKey: string, variety = VARIETY): number {
  return THICKNESS * (1 + variety * (thicknessHash(bookKey) - 0.5) * VARIETY_SPAN);
}

/** A book shaped by its cover: the standard footprint until the cover's shape is known. */
export function shapedBook(bookKey: string): BookShape {
  return { width: STANDARD_WIDTH, depth: STANDARD_DEPTH, thickness: bookThickness(bookKey), yaw: 0, x: 0, z: 0 };
}

/**
 * A pile book's shape: with cover shapes, shaped by its book (thickness) and later its cover
 * (footprint); without, the seeded size it had before (stackModel.bookShape, by household and key).
 */
export function pileShape(coverShapes: boolean, seed: string, item: { key: string; isbn: string }): BookShape {
  return coverShapes ? shapedBook(item.isbn) : bookShape(seed, item.key);
}

/**
 * The biggest book a shaped pile can have, for the room it must leave (the resting rule's K and
 * how far a book at the eye line reaches): the thickest book, with the footprint whose diagonal
 * is longest (the tallest cover's).
 */
export const BIGGEST_SHAPED_BOOK = (() => {
  const [lo, hi] = ASPECT_RANGE;
  const candidates = [coverFootprint(lo), coverFootprint(hi), coverFootprint(REF_ASPECT)];
  const longest = candidates.reduce((a, b) => (Math.hypot(b.width, b.depth) > Math.hypot(a.width, a.depth) ? b : a));
  return { thickness: THICKEST, width: longest.width, depth: longest.depth };
})();

/** A size rounded to its cache bucket. */
export function sizeBucket(px: number, step: number): number {
  return Math.max(step, Math.round(px / step) * step);
}

/** A footprint part way (0–1) from one to another: a shape easing in as its cover's shape arrives. */
export function easeFootprint(from: Footprint, to: Footprint, progress: number): Footprint {
  const p = Math.min(1, Math.max(0, progress));
  return { width: from.width + (to.width - from.width) * p, depth: from.depth + (to.depth - from.depth) * p };
}

/** The spine's text scales with the book's thickness (the reference book's size at THICKNESS). */
export function spineTextScale(thickness: number): number {
  return Math.max(0, thickness) / THICKNESS;
}
