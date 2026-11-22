import { describe, expect, it } from 'vitest';
import {
  centredBox,
  clampRect,
  clampView,
  FULL,
  moveRect,
  outputSize,
  photoBox,
  resizeRect,
  rotatedSize,
  rotateRect90,
  sourceRectPx,
  START_VIEW,
  zoomAround,
  type Rect,
} from '../cropMath';
import { suggestCrop, type Pixels } from '../suggestCrop';

// The cover photo crop (src/books/crop): the maths and the starting-rectangle guess.

const near = (r: Rect | null, expected: Rect, within = 0.03) => {
  expect(r).not.toBeNull();
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(r![k] - expected[k])).toBeLessThanOrEqual(within);
};

/** A seeded pseudo-random number (so the "photos" are the same every run). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A synthetic photo: `paint` gives each pixel's colour; a little sensor noise on top. */
function photo(width: number, height: number, paint: (x: number, y: number) => [number, number, number], noise = 6, seed = 1): Pixels {
  const rand = random(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      const jitter = () => (rand() - 0.5) * 2 * noise;
      data[i] = r + jitter();
      data[i + 1] = g + jitter();
      data[i + 2] = b + jitter();
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const TABLE: [number, number, number] = [222, 214, 200];
const inBox = (x: number, y: number, box: { x0: number; y0: number; x1: number; y1: number }) => x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;

describe('crop rectangle', () => {
  it('stays inside the photo and at least the minimum size', () => {
    expect(clampRect({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(clampRect({ x: 0.5, y: 0.5, w: 0.01, h: 2 }, 0.1, 0.1)).toEqual({ x: 0.5, y: 0, w: 0.1, h: 1 });
    expect(moveRect({ x: 0.6, y: 0.1, w: 0.3, h: 0.3 }, 0.5, -0.5)).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.3 });
  });

  it('resizes from a corner, keeping the opposite corner, never past the edges or below the minimum', () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    expect(resizeRect(r, 'se', 0.1, 0.2, 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: expect.closeTo(0.6, 10) as number });
    const nw = resizeRect(r, 'nw', -0.5, -0.5, 0.1, 0.1);
    expect([nw.x, nw.y, nw.w, nw.h]).toEqual([0, 0, 0.6000000000000001, 0.6000000000000001].map((v) => expect.closeTo(v, 10)));
    const tiny = resizeRect(r, 'ne', -1, 1, 0.1, 0.1);
    expect([tiny.x, tiny.w, tiny.h].map((v) => +v.toFixed(6))).toEqual([0.2, 0.1, 0.1]);
    expect(+tiny.y.toFixed(6)).toBe(0.5);
  });

  it('turns with the photo: four quarter turns bring it back', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.5 };
    // A quarter clockwise: the top-left area moves to the top right.
    const turned = rotateRect90(r);
    expect([turned.x, turned.y, turned.w, turned.h].map((v) => +v.toFixed(10))).toEqual([0.3, 0.1, 0.5, 0.3]);
    const back = rotateRect90(rotateRect90(rotateRect90(rotateRect90(r))));
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(back[k]).toBeCloseTo(r[k], 10);
    expect(rotateRect90(FULL)).toEqual(FULL);
    expect(rotatedSize(4000, 3000, 1)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(4000, 3000, 2)).toEqual({ width: 4000, height: 3000 });
  });

  it('pixels: whole, inside the photo, at least one', () => {
    expect(sourceRectPx({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, 2400, 1800)).toEqual({ sx: 600, sy: 180, sw: 1200, sh: 1440 });
    expect(sourceRectPx({ x: 0.999, y: 0.999, w: 0.0001, h: 0.0001 }, 100, 100)).toEqual({ sx: 99, sy: 99, sw: 1, sh: 1 });
    expect(sourceRectPx(FULL, 640, 480)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 480 });
  });

  it('output: the crop’s own shape, at most 800 px on its long side, never enlarged', () => {
    expect(outputSize(1200, 1800, 800)).toEqual({ width: 533, height: 800 });
    expect(outputSize(2400, 1200, 800)).toEqual({ width: 800, height: 400 });
    expect(outputSize(300, 450, 800)).toEqual({ width: 300, height: 450 });
    expect(outputSize(1, 5000, 800)).toEqual({ width: 1, height: 800 });
  });

  it('the fallback is a centred 2:3 box', () => {
    const box = centredBox(3000, 4000); // a phone photo held upright
    expect(box.x).toBeCloseTo((1 - box.w) / 2, 10);
    expect(box.y).toBeCloseTo(0.1, 10);
    expect((box.w * 3000) / (box.h * 4000)).toBeCloseTo(2 / 3, 10);
    const wide = centredBox(4000, 3000);
    expect((wide.w * 4000) / (wide.h * 3000)).toBeCloseTo(2 / 3, 10);
    expect(wide.h).toBeCloseTo(0.8, 10);
  });
});

describe('zoom and pan', () => {
  const stage = { width: 400, height: 600 };
  const pic = { width: 2000, height: 1500 };
  const base = 400 / 2000; // fits the width

  it('zooms round the finger: the photo point under it stays under it', () => {
    // (Near the middle in height: zoomed twice, the photo is just as tall as the stage.)
    const at = { x: 300, y: 310 };
    const before = photoBox(START_VIEW, stage, pic, base);
    const u = (at.x - before.left) / before.width;
    const v = (at.y - before.top) / before.height;
    const view = zoomAround(START_VIEW, 2, at, stage, pic, base);
    const after = photoBox(view, stage, pic, base);
    expect(view.zoom).toBe(2);
    expect(after.left + u * after.width).toBeCloseTo(at.x, 6);
    expect(after.top + v * after.height).toBeCloseTo(at.y, 6);
  });

  it('never zooms out past fitting, nor drags the photo away', () => {
    expect(zoomAround(START_VIEW, 0.5, { x: 10, y: 10 }, stage, pic, base)).toEqual(START_VIEW);
    expect(clampView({ zoom: 1, panX: 300, panY: -80 }, stage, pic, base)).toEqual(START_VIEW);
    const far = clampView({ zoom: 2, panX: 5000, panY: 0 }, stage, pic, base);
    // Twice as wide as the stage: up to half the extra width, plus a little slack.
    expect(far.panX).toBe(200 + 24);
    expect(clampView({ zoom: 99, panX: 0, panY: 0 }, stage, pic, base).zoom).toBe(6);
  });
});

describe('the suggested crop', () => {
  it('finds a book on a plain table (its bounding box, with a small margin)', () => {
    const book = { x0: 30, y0: 18, x1: 66, y1: 72 };
    // A dark blue cover with a pale title panel (close to the table colour) inside it.
    const pic = photo(96, 96, (x, y) =>
      inBox(x, y, { x0: 36, y0: 26, x1: 60, y1: 36 }) ? [228, 220, 206] : inBox(x, y, book) ? [40, 70, 150] : TABLE,
    );
    near(suggestCrop(pic), { x: 30 / 96 - 0.02, y: 18 / 96 - 0.02, w: 36 / 96 + 0.04, h: 54 / 96 + 0.04 });
  });

  it('finds a pale book on a dark table, and a wide book in a wide photo', () => {
    near(
      suggestCrop(photo(96, 72, (x, y) => (inBox(x, y, { x0: 20, y0: 10, x1: 50, y1: 60 }) ? [245, 240, 225] : [60, 45, 35]))),
      { x: 20 / 96 - 0.02, y: 10 / 72 - 0.02, w: 30 / 96 + 0.04, h: 50 / 72 + 0.04 },
    );
    near(
      suggestCrop(photo(96, 64, (x, y) => (inBox(x, y, { x0: 10, y0: 16, x1: 86, y1: 50 }) ? [200, 40, 40] : TABLE))),
      { x: 10 / 96 - 0.02, y: 16 / 64 - 0.02, w: 76 / 96 + 0.04, h: 34 / 64 + 0.04 },
    );
  });

  it('keeps the largest patch, not a small thing beside the book', () => {
    const pic = photo(96, 96, (x, y) =>
      inBox(x, y, { x0: 40, y0: 20, x1: 80, y1: 80 }) ? [30, 120, 60] : inBox(x, y, { x0: 6, y0: 70, x1: 14, y1: 78 }) ? [10, 10, 10] : TABLE,
    );
    near(suggestCrop(pic), { x: 40 / 96 - 0.02, y: 20 / 96 - 0.02, w: 40 / 96 + 0.04, h: 60 / 96 + 0.04 });
  });

  it('gives up (centred box instead) on a busy background, an empty photo, or a book filling the photo', () => {
    const rand = random(7);
    const busy = photo(96, 96, () => [rand() * 255, rand() * 255, rand() * 255], 0);
    expect(suggestCrop(busy)).toBeNull();
    // Stripes: half the border is far from its median colour.
    expect(suggestCrop(photo(96, 96, (x) => (Math.floor(x / 8) % 2 ? [20, 20, 20] : [240, 240, 240])))).toBeNull();
    expect(suggestCrop(photo(96, 96, () => TABLE))).toBeNull();
    expect(suggestCrop(photo(96, 96, (x, y) => (inBox(x, y, { x0: 1, y0: 1, x1: 95, y1: 95 }) ? [40, 70, 150] : TABLE)))).toBeNull();
    expect(suggestCrop({ width: 4, height: 4, data: new Uint8ClampedArray(64) })).toBeNull();
  });
});
