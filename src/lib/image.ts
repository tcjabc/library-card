/**
 * Shrinks a photo to at most `maxEdge` pixels on its long edge and re-encodes
 * it as JPEG. Phone photos are 3-12 MB; a cover needs ~100 KB.
 * Uses an <img> to decode, which applies EXIF orientation in all current
 * browsers (so portrait photos from iOS stay upright).
 *
 * With `maxBytes`, a result that is still too large is re-encoded at lower
 * quality, then at a smaller size, until it fits.
 */
export async function resizeImage(
  file: Blob,
  maxEdge = 800,
  quality = 0.8,
  maxBytes = Infinity,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await fitToBytes((edge, q) => encode(img, edge, q), maxEdge, quality, maxBytes);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The first encoding that is at most `maxBytes`: quality first (cheap, keeps detail), then size
 * (800 px -> 640 -> 512 ...). Rejects if even the smallest try is too large.
 */
export async function fitToBytes(
  encodeAt: (maxEdge: number, quality: number) => Promise<Blob>,
  maxEdge: number,
  quality: number,
  maxBytes: number,
): Promise<Blob> {
  const qualities = [quality, 0.7, 0.6, 0.5, 0.4].filter((q, i) => i === 0 || q < quality);
  let edge = maxEdge;
  for (let round = 0; round < 6; round++) {
    for (const q of qualities) {
      const blob = await encodeAt(edge, q);
      if (blob.size <= maxBytes) return blob;
    }
    edge = Math.round(edge * 0.8);
  }
  throw new Error('This photo could not be made small enough.');
}

function encode(img: HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  // JPEG has no transparency; paint white behind PNG/HEIC alpha.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))), 'image/jpeg', quality),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file is not an image the browser can read.'));
    img.src = src;
  });
}
