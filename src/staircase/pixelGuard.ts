/**
 * The Family Staircase never reads pixels from a canvas that holds a picture loaded without CORS
 * (a Google Books thumbnail: drawable, but it taints the canvas, and reading a tainted canvas
 * throws). This module is the only staircase code allowed to read pixels (eslint.config.js bans
 * getImageData, toDataURL, toBlob and convertToBlob everywhere else in src/staircase, and
 * __tests__/pixelGuard.test.ts checks the sources too):
 *
 * - a canvas that receives such a picture is marked (markTainted), and drawing a marked canvas
 *   onto another marks that one too (drawGuarded);
 * - readPixels refuses a marked canvas (TaintedCanvasError), before the browser would;
 * - the cover colour sampler reads only its own small canvas, drawn from CORS-safe covers.
 *
 * The pile's own canvas is never read in the app; the developer tools' raster timing goes through
 * flushForTiming, which skips a marked canvas.
 */

const tainted = new WeakSet<object>();

export class TaintedCanvasError extends Error {
  constructor() {
    super('This canvas holds a picture loaded without CORS: its pixels are never read.');
    this.name = 'TaintedCanvasError';
  }
}

/** Note that `canvas` holds (or may hold) a picture loaded without CORS. */
export function markTainted(canvas: object): void {
  tainted.add(canvas);
}

export function isTainted(canvas: object): boolean {
  return tainted.has(canvas);
}

/** A context's canvas (a plain object in tests). */
type Target = Pick<CanvasRenderingContext2D, 'drawImage'> & { canvas: object };

/**
 * ctx.drawImage(source, dx, dy, dw, dh), marking ctx's canvas when the source is marked (a
 * tainted canvas drawn onto another taints that one too) or `taintedSource` says so (an <img>
 * loaded without CORS).
 */
export function drawGuarded(ctx: Target, source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number, taintedSource = false): void {
  if (taintedSource || (typeof source === 'object' && source !== null && tainted.has(source))) tainted.add(ctx.canvas);
  ctx.drawImage(source, dx, dy, dw, dh);
}

/** The only pixel read in the staircase: refuses a canvas that holds a picture loaded without CORS. */
export function readPixels(ctx: Pick<CanvasRenderingContext2D, 'getImageData'> & { canvas: object }, x: number, y: number, width: number, height: number): Uint8ClampedArray {
  if (tainted.has(ctx.canvas)) throw new TaintedCanvasError();
  return ctx.getImageData(x, y, width, height).data;
}

/**
 * Developer tools' "Measure raster": a 1-pixel read that makes the browser finish drawing, timed
 * by the caller. Skipped (false) on a canvas that holds a picture loaded without CORS.
 */
export function flushForTiming(ctx: Pick<CanvasRenderingContext2D, 'getImageData'> & { canvas: object }): boolean {
  if (tainted.has(ctx.canvas)) return false;
  ctx.getImageData(0, 0, 1, 1);
  return true;
}
