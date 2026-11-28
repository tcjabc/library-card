import { MM_PER_UNIT, POSTER_FRAME, POSTER_STROKES } from '../posterLayout';
import { mapPath, parsePath, pathPoints, writePath } from './pathGeometry';
import type { PosterArt, PosterShape } from './types';

/**
 * Fitting a drawing into a poster's art column (1.24.0). The journey drawings were made on a
 * design canvas in poster units, a little too big for the art band. fitPosterArt scales a whole
 * drawing uniformly about the centre line (x 397) and centres it in the art band, as large as fits
 * with its strokes inside the band and at least 1 mm clear of every slot circle. Strokes keep
 * their weight (2.5 units) because the drawing is resized, not the lines.
 *
 * Source shapes may use any SVG path syntax (relative commands too); the fitted art is written in
 * absolute M L H V C Q A Z, as the art test reads it.
 */

/** The clear gap between the art and every slot circle, so they never look joined on paper: 1 mm. */
export const ART_CLEARANCE = 1 / MM_PER_UNIT;

const F = POSTER_FRAME;
const HALF_STROKE = POSTER_STROKES.art / 2;
/** Room for rounding the fitted coordinates to 0.01. */
const SAFETY = 0.5;

/** Where the centre of every art line may go: the band and column, less half a stroke. */
export const ART_LIMITS = {
  top: F.slotTop + HALF_STROKE,
  bottom: F.slotBottom - HALF_STROKE,
  halfWidth: Math.min(F.artHalf, F.circleOffset - F.circleRadius - POSTER_STROKES.circle / 2 - ART_CLEARANCE) - HALF_STROKE,
};

/** The source drawing's shapes, scaled and centred into the art column. */
export function fitPosterArt(source: readonly PosterShape[]): PosterArt {
  const parsed = source.map((shape) => parsePath(shape.d));
  const points = parsed.flatMap((segments) => pathPoints(segments));
  const ys = points.map(([, y]) => y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const reach = Math.max(...points.map(([x]) => Math.abs(x - F.centre)));
  const scale = Math.min((ART_LIMITS.bottom - ART_LIMITS.top - 2 * SAFETY) / (bottom - top), (ART_LIMITS.halfWidth - SAFETY) / reach);
  const middle = (ART_LIMITS.top + ART_LIMITS.bottom) / 2;
  const centreY = (top + bottom) / 2;
  const place = (x: number, y: number): [number, number] => [F.centre + scale * (x - F.centre), middle + scale * (y - centreY)];
  return {
    shapes: source.map((shape, i) => ({ ...shape, d: writePath(mapPath(parsed[i], place, scale)) })),
  };
}

/** Drawing helpers, in source units (path data the fit reads). */
export const rect = (x: number, y: number, w: number, h: number, r = 0): string =>
  r > 0
    ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
    : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

export const ellipse = (cx: number, cy: number, rx: number, ry: number): string =>
  `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;

export const circle = (cx: number, cy: number, r: number): string => ellipse(cx, cy, r, r);

/** An SVG polygon's points ("x,y x,y …"), closed. */
export const polygon = (points: string): string =>
  'M' +
  points
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(',', ' '))
    .join('L') +
  'Z';
