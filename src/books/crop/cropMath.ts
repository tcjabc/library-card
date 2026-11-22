/**
 * The crop screen's maths (pure, unit-tested). A crop rectangle is in fractions of the photo
 * (0 to 1 across and down), so it doesn't depend on the photo's pixel size or how big it shows.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** The whole photo. */
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Inside the photo and at least min wide and high. */
export function clampRect(r: Rect, minW = 0, minH = 0): Rect {
  const w = clamp(r.w, Math.min(minW, 1), 1);
  const h = clamp(r.h, Math.min(minH, 1), 1);
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

/** Dragging the rectangle: it keeps its size and stops at the photo's edges. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h), w: r.w, h: r.h };
}

/** Dragging a corner: the opposite corner stays put; never smaller than min, never past the edges. */
export function resizeRect(r: Rect, corner: Corner, dx: number, dy: number, minW: number, minH: number): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (corner === 'nw' || corner === 'sw') left = clamp(left + dx, 0, right - minW);
  else right = clamp(right + dx, left + minW, 1);
  if (corner === 'nw' || corner === 'ne') top = clamp(top + dy, 0, bottom - minH);
  else bottom = clamp(bottom + dy, top + minH, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Turning the photo a quarter clockwise: a point (u, v) moves to (1 − v, u), so the rectangle turns with it. */
export function rotateRect90(r: Rect): Rect {
  return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
}

/** A photo's size after this many quarter turns. */
export function rotatedSize(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  return quarterTurns % 2 === 0 ? { width, height } : { width: height, height: width };
}

/** The rectangle in whole pixels of a width × height photo: at least 1 px, never outside it. */
export function sourceRectPx(r: Rect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = clamp(Math.round(r.x * width), 0, width - 1);
  const sy = clamp(Math.round(r.y * height), 0, height - 1);
  const ex = clamp(Math.round((r.x + r.w) * width), sx + 1, width);
  const ey = clamp(Math.round((r.y + r.h) * height), sy + 1, height);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/** The saved photo's size: the crop's own shape, at most maxEdge on its long side, never enlarged. */
export function outputSize(sw: number, sh: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  return { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) };
}

/**
 * The fallback starting rectangle: a box of the given shape (width / height in pixels, a book's
 * 2:3 by default), as big as fits in `fill` of the photo, in the middle.
 */
export function centredBox(width: number, height: number, aspect = 2 / 3, fill = 0.8): Rect {
  let boxH = height * fill;
  let boxW = boxH * aspect;
  if (boxW > width * fill) {
    boxW = width * fill;
    boxH = boxW / aspect;
  }
  const w = boxW / width;
  const h = boxH / height;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** A rectangle grown by `margin` (a fraction of the photo) on every side, kept inside the photo. */
export function withMargin(r: Rect, margin: number): Rect {
  const x = Math.max(0, r.x - margin);
  const y = Math.max(0, r.y - margin);
  return { x, y, w: Math.min(1, r.x + r.w + margin) - x, h: Math.min(1, r.y + r.h + margin) - y };
}

// The photo on the screen ------------------------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

/** How the photo is shown: zoom (1 = fits the stage) and pan (px from centred). */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const START_VIEW: View = { zoom: 1, panX: 0, panY: 0 };
export const MAX_ZOOM = 6;

/** Screen px per photo px at zoom 1: the photo fits the stage with a little room round it for the handles. */
export function fitScale(stage: Size, photo: Size, inset = 0.9): number {
  if (photo.width <= 0 || photo.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(stage.width / photo.width, stage.height / photo.height) * inset;
}

/** Where the photo is on the stage, in px. */
export function photoBox(view: View, stage: Size, photo: Size, base: number): { left: number; top: number; width: number; height: number } {
  const width = photo.width * base * view.zoom;
  const height = photo.height * base * view.zoom;
  return { left: (stage.width - width) / 2 + view.panX, top: (stage.height - height) / 2 + view.panY, width, height };
}

/**
 * Keeps the photo from being dragged away: centred while it fits the stage, and once it's bigger,
 * never further than its edge (plus `slack` px, so a handle on the edge can still be reached).
 */
export function clampView(view: View, stage: Size, photo: Size, base: number, slack = 24): View {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const box = photoBox({ ...view, zoom }, stage, photo, base);
  const maxX = Math.max(0, (box.width - stage.width) / 2 + slack);
  const maxY = Math.max(0, (box.height - stage.height) / 2 + slack);
  return { zoom, panX: zoom === 1 ? 0 : clamp(view.panX, -maxX, maxX), panY: zoom === 1 ? 0 : clamp(view.panY, -maxY, maxY) };
}

/** Zooming by `factor` with the photo point under `at` (stage px) staying under it. */
export function zoomAround(view: View, factor: number, at: { x: number; y: number }, stage: Size, photo: Size, base: number): View {
  const zoom = clamp(view.zoom * factor, 1, MAX_ZOOM);
  const box = photoBox(view, stage, photo, base);
  const u = box.width > 0 ? (at.x - box.left) / box.width : 0.5;
  const v = box.height > 0 ? (at.y - box.top) / box.height : 0.5;
  const width = box.width * (zoom / view.zoom);
  const height = box.height * (zoom / view.zoom);
  const panX = at.x - u * width - (stage.width - width) / 2;
  const panY = at.y - v * height - (stage.height - height) / 2;
  return clampView({ zoom, panX, panY }, stage, photo, base);
}
