import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { TaintedCanvasError, drawGuarded, flushForTiming, isTainted, markTainted, readPixels } from '../pixelGuard';

/** A pretend 2D context on its own pretend canvas. */
function context() {
  const canvas = {};
  return { canvas, drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) }) as unknown as ImageData) };
}

describe('never reading pixels from a canvas that holds a picture loaded without CORS', () => {
  it('reads a clean canvas', () => {
    const ctx = context();
    expect(readPixels(ctx, 0, 0, 1, 1)).toHaveLength(4);
    expect(ctx.getImageData).toHaveBeenCalledOnce();
  });

  it('refuses a marked canvas before the browser is asked', () => {
    const ctx = context();
    markTainted(ctx.canvas);
    expect(() => readPixels(ctx, 0, 0, 1, 1)).toThrow(TaintedCanvasError);
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });

  it('a tainted <img> drawn onto a canvas marks it, and that canvas drawn onto another marks that one too', () => {
    const small = context();
    const sample = context();
    const img = {} as CanvasImageSource;
    drawGuarded(small, img, 0, 0, 10, 10, true);
    expect(isTainted(small.canvas)).toBe(true);
    drawGuarded(sample, small.canvas as CanvasImageSource, 0, 0, 1, 1);
    expect(isTainted(sample.canvas)).toBe(true);
    expect(() => readPixels(sample, 0, 0, 1, 1)).toThrow(TaintedCanvasError);
    expect(sample.drawImage).toHaveBeenCalledOnce();
  });

  it('a CORS-safe picture leaves the canvas readable', () => {
    const ctx = context();
    drawGuarded(ctx, {} as CanvasImageSource, 0, 0, 1, 1);
    expect(isTainted(ctx.canvas)).toBe(false);
  });

  it('the raster timing probe skips a marked canvas', () => {
    const clean = context();
    const marked = context();
    markTainted(marked.canvas);
    expect(flushForTiming(clean)).toBe(true);
    expect(flushForTiming(marked)).toBe(false);
    expect(marked.getImageData).not.toHaveBeenCalled();
  });

  it('no staircase code but pixelGuard.ts calls getImageData, toDataURL, toBlob or convertToBlob', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(name) || name === 'pixelGuard.ts') continue;
      const text = readFileSync(join(dir, name), 'utf8');
      // Comments may name them; code may not.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\.\s*(getImageData|toDataURL|toBlob|convertToBlob)\b/.test(code)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
