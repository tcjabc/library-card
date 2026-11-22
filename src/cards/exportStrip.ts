import { STRIP_PNG } from './stripLayout';

/** A strip's SVG markup as a file. */
export function stripSvgBlob(svg: string): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' });
}

/**
 * The strip as a 300 dpi PNG (2022 × 638 px). The SVG only holds data-URL images, so drawing it
 * through an <img> keeps the canvas readable.
 */
export async function stripPngBlob(svg: string, size: { width: number; height: number } = STRIP_PNG): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The card drawing could not be read.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the PNG.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
