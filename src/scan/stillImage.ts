import type { DetectSource, Detection, ScanFormat } from './detector';

/**
 * Barcodes in a still image (a canvas, or a photo the grown-up picked) rather than the live
 * camera. The detector is loaded on first use, like the live scanner's.
 */

export async function detectStill(source: DetectSource, formats: readonly ScanFormat[]): Promise<Detection[]> {
  const { createDetector } = await import('./detector');
  const detector = await createDetector(formats);
  const codes = await detector.detect(source);
  return codes.filter((c) => c.rawValue && (formats as readonly string[]).includes(c.format));
}

/**
 * Barcodes in a photo file, decoded from the ORIGINAL file at full size (never a shrunk JPEG:
 * thin bars need every pixel). createImageBitmap applies the photo's EXIF orientation; if it
 * can't read the file, or finds nothing, the file itself is tried.
 */
export async function detectInPhoto(file: Blob, formats: readonly ScanFormat[]): Promise<Detection[]> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some formats (e.g. HEIC on some browsers) only decode as a Blob.
  }
  try {
    if (bitmap) {
      const found = await detectStill(bitmap, formats);
      if (found.length) return found;
    }
    return await detectStill(file, formats);
  } finally {
    bitmap?.close();
  }
}
