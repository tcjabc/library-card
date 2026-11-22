import { fitToBytes } from '../../lib/image';
import { COVER_PHOTO } from '../coverPhoto';
import { outputSize, rotatedSize, sourceRectPx, type Rect } from './cropMath';
import type { Pixels } from './suggestCrop';

/**
 * The crop screen's drawing (browser only). Photos are decoded with an <img>, which applies the
 * photo's EXIF orientation (so a phone photo held upright stays upright), as resizeImage does.
 */

/** The copy of the photo the crop screen works on (and crops from): at most this on its long side. */
export const WORK_MAX_EDGE = 2400;

export async function decodePhoto(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This file is not an image the browser can read.'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('This image is empty.');
    // (Not img.decode(): it can wait forever for an image that isn't on the page. Loaded is enough to draw it.)
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  return { canvas, ctx };
}

/** The photo turned clockwise by quarter turns, at most WORK_MAX_EDGE on its long side. */
export function workingCopy(img: HTMLImageElement, quarterTurns: number): HTMLCanvasElement {
  const scale = Math.min(1, WORK_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const turns = ((quarterTurns % 4) + 4) % 4;
  const size = rotatedSize(w, h, turns);
  const { canvas, ctx } = canvas2d(size.width, size.height);
  canvas.className = 'crop__canvas';
  // JPEG has no transparency; paint white behind PNG/HEIC alpha.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.translate(turns === 1 || turns === 2 ? size.width : 0, turns === 2 || turns === 3 ? size.height : 0);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/** A small copy's pixels, for suggestCrop. */
export function samplePixels(source: HTMLCanvasElement, maxEdge = 96): Pixels {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const { ctx } = canvas2d(w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** The cropped part as a cover photo (COVER_PHOTO rules: smaller or lower quality until it fits). */
export function encodeCrop(source: HTMLCanvasElement, rect: Rect): Promise<Blob> {
  const { sx, sy, sw, sh } = sourceRectPx(rect, source.width, source.height);
  return fitToBytes(
    (maxEdge, quality) => {
      const out = outputSize(sw, sh, maxEdge);
      const { canvas, ctx } = canvas2d(out.width, out.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))), 'image/jpeg', quality),
      );
    },
    COVER_PHOTO.maxEdge,
    COVER_PHOTO.quality,
    COVER_PHOTO.maxBytes,
  );
}
