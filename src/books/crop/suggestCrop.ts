import { withMargin, type Rect } from './cropMath';

/** RGBA pixels, as from a canvas's getImageData (a small copy of the photo: about 96 px across). */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Around the found book, this much of the photo is kept on each side. */
export const SUGGEST_MARGIN = 0.02;

/**
 * A starting crop for a photo of a book on a table (pure, unit-tested): the background's colour
 * from the photo's border, then the largest patch that clearly differs from it, and that patch's
 * bounding box with a small margin. Null when it can't tell (a busy or uneven background, nothing
 * found, or the book already fills the photo); the screen then starts from a centred box. The
 * rectangle is only a suggestion: it can always be moved and resized.
 */
export function suggestCrop({ width: w, height: h, data }: Pixels): Rect | null {
  if (w < 8 || h < 8 || data.length < w * h * 4) return null;
  const n = w * h;

  // 1. The background: the median colour of a thin ring round the edge.
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) border.push(y * w + x);
    }
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const bg = [0, 1, 2].map((c) => median(border.map((i) => data[i * 4 + c])));
  const distance = (i: number) => Math.hypot(data[i * 4] - bg[0], data[i * 4 + 1] - bg[1], data[i * 4 + 2] - bg[2]);

  // 2. A plain background only: most of the border close to its median colour.
  const borderDistances = border.map(distance);
  const spread = median(borderDistances);
  const far = borderDistances.filter((d) => d > 48).length / border.length;
  if (spread > 24 || far > 0.3) return null;

  // 3. What clearly differs from the background, with small gaps closed (a white title panel
  //    on a white table) by growing the patches a little.
  const threshold = Math.max(40, spread * 3 + 16);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = distance(i) > threshold ? 1 : 0;
  const grow = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const grown = dilate(mask, w, h, grow);

  // 4. The largest connected patch, and its bounding box.
  const best = largestPatch(grown, w, h);
  if (!best || best.count < n * 0.04) return null;
  const x0 = Math.min(w - 1, best.minX + grow);
  const y0 = Math.min(h - 1, best.minY + grow);
  const x1 = Math.max(x0, best.maxX - grow);
  const y1 = Math.max(y0, best.maxY - grow);
  // Growing stops at the photo's edge, so only undo it where it didn't reach the edge.
  const left = best.minX === 0 ? 0 : x0;
  const top = best.minY === 0 ? 0 : y0;
  const right = best.maxX === w - 1 ? w - 1 : x1;
  const bottom = best.maxY === h - 1 ? h - 1 : y1;
  const box: Rect = { x: left / w, y: top / h, w: (right - left + 1) / w, h: (bottom - top + 1) / h };

  // 5. Not useful: tiny, filling the photo, or running off three or four sides (not a book on a table).
  const edges = [left === 0, top === 0, right === w - 1, bottom === h - 1].filter(Boolean).length;
  const area = box.w * box.h;
  if (area < 0.06 || area > 0.96 || edges >= 3) return null;
  return withMargin(box, SUGGEST_MARGIN);
}

/** Square dilation by r px (each set pixel sets its neighbours within r), in two passes. */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    // Distance to the nearest set pixel to the left, then to the right.
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) across[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) across[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (across[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (across[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

interface Patch {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The biggest 4-connected group of set pixels. */
function largestPatch(mask: Uint8Array, w: number, h: number): Patch | null {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best: Patch | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const patch: Patch = { count: 0, minX: w, minY: h, maxX: -1, maxY: -1 };
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      patch.count++;
      if (x < patch.minX) patch.minX = x;
      if (x > patch.maxX) patch.maxX = x;
      if (y < patch.minY) patch.minY = y;
      if (y > patch.maxY) patch.maxY = y;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of next) {
        if (j >= 0 && mask[j] && !seen[j]) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (!best || patch.count > best.count) best = patch;
  }
  return best;
}
