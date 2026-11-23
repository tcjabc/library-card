/**
 * The book pile seen by an orthographic camera, for the canvas renderer (pure, unit-tested).
 * Each book is a box at its place in the pile, turned about the vertical axis by its yaw, then
 * the whole pile is turned by the camera's yaw and tipped by its pitch, with no perspective. A
 * box's faces are parallelograms on screen, so the canvas can draw each with one affine setTransform.
 *
 * Stage 2a, "books that face the reader": book i (0 = the oldest) is turned i * twist degrees,
 * and the camera at position s (a continuous book index) is turned s * twist, so the book at s
 * faces the reader square-on and its neighbours fan out by twist degrees each (the fan model
 * below). The camera only tips; each book gets its turn relative to the camera.
 *
 * STACK_CAMERA is the fixed camera of the CSS 3D version (BookStack.tsx), kept so the geometry
 * can be checked against CSS.
 *
 * Coordinates follow CSS: x to the right, y down (down the pile), z towards the viewer. A book's
 * own axes: u along the spine (left to right), v down through its thickness, s from back to front.
 */
import { TILT_X_DEG, TILT_Y_DEG, type BookShape } from './stackModel';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where the camera looks from, in degrees: the same turns as the CSS pile (rotateX(pitch) rotateY(yaw)). */
export interface Camera {
  /** Tip about the screen's horizontal axis; negative looks down on the tops. */
  pitch: number;
  /** Turn about the pile's vertical axis; negative shows the books' right-hand sides. */
  yaw: number;
}

/** The fixed camera of the CSS 3D version. */
export const STACK_CAMERA: Camera = { pitch: TILT_X_DEG, yaw: TILT_Y_DEG };

/** A camera and where the pile's axis (its top, centred) is on screen (px). */
export interface View {
  camera: Camera;
  originX: number;
  originY: number;
}

/** A point on screen (px) and how near the viewer it is (bigger = nearer). */
export interface ScreenPoint extends Vec2 {
  depth: number;
}

const RAD = Math.PI / 180;

interface Basis {
  cy: number;
  sy: number;
  cp: number;
  sp: number;
  ox: number;
  oy: number;
}

function basis(view: View): Basis {
  const yaw = view.camera.yaw * RAD;
  const pitch = view.camera.pitch * RAD;
  return { cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), ox: view.originX, oy: view.originY };
}

function project(b: Basis, x: number, y: number, z: number): ScreenPoint {
  // rotateY(yaw), then rotateX(pitch), as CSS applies `rotateX(pitch) rotateY(yaw)`.
  const x1 = b.cy * x + b.sy * z;
  const z1 = -b.sy * x + b.cy * z;
  return { x: b.ox + x1, y: b.oy + b.cp * y - b.sp * z1, depth: b.sp * y + b.cp * z1 };
}

/** A point in the pile (px, from the pile's axis at its top) on screen. */
export function projectPoint(p: Vec3, view: View): ScreenPoint {
  return project(basis(view), p.x, p.y, p.z);
}

/**
 * One book to draw: its shape (size, nudges and its yaw relative to the camera) and where its
 * top is (px, y down) from the camera's origin height. Bigger `top` = lower in the pile.
 */
export interface PlacedBook {
  step: number;
  top: number;
  shape: BookShape;
}

export type FaceSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/**
 * A face on screen: the parallelogram with corners origin, origin + u, origin + u + v and
 * origin + v. `width` and `height` are the face's own size (px), along u and along v.
 */
export interface ProjectedFace {
  side: FaceSide;
  origin: Vec2;
  u: Vec2;
  v: Vec2;
  width: number;
  height: number;
}

export interface ProjectedBook {
  step: number;
  /** How far the book's top is from the top of the pile (px): bigger = lower in the pile. */
  top: number;
  /** How near the viewer the book's centre is. */
  depth: number;
  /** The faces the camera sees (a box shows at most three). */
  faces: ProjectedFace[];
}

interface FaceSpec {
  side: FaceSide;
  /** The outward normal, in the book's own axes. */
  normal: Vec3;
  /** The corner where the face's texture starts, and its two edges, as multiples of (w, t, d) / 2. */
  corner: Vec3;
  u: Vec3;
  v: Vec3;
}

/**
 * Each face set up so its texture reads the right way round from outside: the spine (front)
 * left to right and top to bottom, the cover (top) from the back edge to the spine, and the
 * page edges like the CSS version's right-hand side.
 */
const FACES: readonly FaceSpec[] = [
  { side: 'front', normal: { x: 0, y: 0, z: 1 }, corner: { x: -1, y: -1, z: 1 }, u: { x: 2, y: 0, z: 0 }, v: { x: 0, y: 2, z: 0 } },
  { side: 'top', normal: { x: 0, y: -1, z: 0 }, corner: { x: -1, y: -1, z: -1 }, u: { x: 2, y: 0, z: 0 }, v: { x: 0, y: 0, z: 2 } },
  { side: 'right', normal: { x: 1, y: 0, z: 0 }, corner: { x: 1, y: -1, z: 1 }, u: { x: 0, y: 0, z: -2 }, v: { x: 0, y: 2, z: 0 } },
  { side: 'left', normal: { x: -1, y: 0, z: 0 }, corner: { x: -1, y: -1, z: -1 }, u: { x: 0, y: 0, z: 2 }, v: { x: 0, y: 2, z: 0 } },
  { side: 'back', normal: { x: 0, y: 0, z: -1 }, corner: { x: 1, y: -1, z: -1 }, u: { x: -2, y: 0, z: 0 }, v: { x: 0, y: 2, z: 0 } },
  { side: 'bottom', normal: { x: 0, y: 1, z: 0 }, corner: { x: -1, y: 1, z: 1 }, u: { x: 2, y: 0, z: 0 }, v: { x: 0, y: 0, z: -2 } },
];

/** Normals this close to edge-on count as hidden, so a face never draws as a sliver. */
const EDGE_ON = 1e-6;

/** A book's visible faces on screen. A face is hidden when it turns away from the camera. */
export function projectBook(book: PlacedBook, view: View): ProjectedBook {
  const b = basis(view);
  const { width: w, depth: d, thickness: t, x, z, yaw } = book.shape;
  const half = { x: w / 2, y: t / 2, z: d / 2 };
  const cy = Math.cos(yaw * RAD);
  const sy = Math.sin(yaw * RAD);
  const cx = x;
  const cyPos = book.top + t / 2;
  const cz = z;
  // A point in the book's own axes, turned by its wobble and moved to its place in the pile.
  const toPile = (lx: number, ly: number, lz: number): Vec3 => ({ x: cx + cy * lx + sy * lz, y: cyPos + ly, z: cz - sy * lx + cy * lz });
  const faces: ProjectedFace[] = [];
  for (const spec of FACES) {
    const n = toPile(spec.normal.x, spec.normal.y, spec.normal.z);
    // How much the normal faces the viewer: the depth of the turned normal (no translation).
    const nx = n.x - cx;
    const ny = n.y - cyPos;
    const nz = n.z - cz;
    const facing = b.sp * ny + b.cp * (-b.sy * nx + b.cy * nz);
    if (facing <= EDGE_ON) continue;
    const c = toPile(spec.corner.x * half.x, spec.corner.y * half.y, spec.corner.z * half.z);
    const cu = toPile(
      spec.corner.x * half.x + spec.u.x * half.x,
      spec.corner.y * half.y + spec.u.y * half.y,
      spec.corner.z * half.z + spec.u.z * half.z,
    );
    const cv = toPile(
      spec.corner.x * half.x + spec.v.x * half.x,
      spec.corner.y * half.y + spec.v.y * half.y,
      spec.corner.z * half.z + spec.v.z * half.z,
    );
    const p0 = project(b, c.x, c.y, c.z);
    const pu = project(b, cu.x, cu.y, cu.z);
    const pv = project(b, cv.x, cv.y, cv.z);
    faces.push({
      side: spec.side,
      origin: { x: p0.x, y: p0.y },
      u: { x: pu.x - p0.x, y: pu.y - p0.y },
      v: { x: pv.x - p0.x, y: pv.y - p0.y },
      width: Math.hypot(spec.u.x * half.x, spec.u.y * half.y, spec.u.z * half.z),
      height: Math.hypot(spec.v.x * half.x, spec.v.y * half.y, spec.v.z * half.z),
    });
  }
  return { step: book.step, top: book.top, depth: project(b, cx, cyPos, cz).depth, faces };
}

/**
 * Painter's algorithm, back to front. The camera always looks down on the pile and books don't
 * pass through each other, so a book lower in the pile is never in front of one above it: paint
 * the lowest first. Ties (never in a real pile) go by depth, then step, so the order is stable.
 */
export function drawOrder<T extends { top: number; depth: number; step: number }>(books: readonly T[]): T[] {
  return [...books].sort((a, b) => b.top - a.top || a.depth - b.depth || a.step - b.step);
}

/** A face's four corners, in order round the edge. */
export function faceCorners(face: ProjectedFace): Vec2[] {
  const { origin: o, u, v } = face;
  return [
    { x: o.x, y: o.y },
    { x: o.x + u.x, y: o.y + u.y },
    { x: o.x + u.x + v.x, y: o.y + u.y + v.y },
    { x: o.x + v.x, y: o.y + v.y },
  ];
}

/** Whether `p` is inside the polygon (even-odd rule; points on an edge may go either way). */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The step of the book drawn on top at `p`, or null. `books` are in draw order (back to front). */
export function hitTest(p: Vec2, books: readonly ProjectedBook[]): number | null {
  for (let i = books.length - 1; i >= 0; i--) {
    for (const face of books[i].faces) if (pointInPolygon(p, faceCorners(face))) return books[i].step;
  }
  return null;
}

/**
 * The canvas transform (a, b, c, d, e, f) that maps a face's own px (0..width, 0..height) onto
 * the face on screen, with screen px scaled by `scale` (the canvas's pixels per CSS px).
 */
export function faceTransform(face: ProjectedFace, scale: number): [number, number, number, number, number, number] {
  const ku = face.width > 0 ? scale / face.width : 0;
  const kv = face.height > 0 ? scale / face.height : 0;
  return [face.u.x * ku, face.u.y * ku, face.v.x * kv, face.v.y * kv, face.origin.x * scale, face.origin.y * scale];
}

// ---- The fan: books that face the reader (stage 2a) ----

/** The camera's tip (degrees above the horizon). */
export const ELEVATION_DEG = 24;
/** Each book is turned this much more than the one under it (degrees). */
export const TWIST_DEG = 10;
export const MAX_TWIST_DEG = 15;
/** The fan's camera: tipped down to see the covers, never turned (books turn relative to it). */
export const FAN_CAMERA: Camera = { pitch: -ELEVATION_DEG, yaw: 0 };

/** Book `index`'s own turn in the world (degrees). */
export function bookYaw(index: number, twist: number = TWIST_DEG): number {
  return index * twist;
}

/** The camera's turn at position `s` (degrees): rises steadily with s. */
export function cameraYaw(s: number, twist: number = TWIST_DEG): number {
  return s * twist;
}

/** Book `index`'s turn relative to the camera at `s` (degrees): 0 for the book at s. */
export function relativeYaw(index: number, s: number, twist: number = TWIST_DEG): number {
  return bookYaw(index, twist) - cameraYaw(s, twist);
}

/** How high each book's centre is above the bottom of the pile (px). `thicknesses` are oldest first. */
export function pileCentres(thicknesses: readonly number[]): number[] {
  const out: number[] = [];
  let y = 0;
  for (const t of thicknesses) {
    const h = Math.max(0, t);
    out.push(y + h / 2);
    y += h;
  }
  return out;
}

/** The height of a continuous position `s` in the pile: book centres, joined in straight lines. */
export function heightAt(centres: readonly number[], s: number): number {
  if (centres.length === 0) return 0;
  const max = centres.length - 1;
  const at = Math.min(max, Math.max(0, Number.isFinite(s) ? s : 0));
  const below = Math.floor(at);
  const above = Math.min(max, below + 1);
  return centres[below] + (centres[above] - centres[below]) * (at - below);
}

/**
 * Book `index` as the camera at `s` sees it: no sideways nudge, turned by its relative yaw, and
 * placed so the height at `s` is the camera's origin (the middle of the screen).
 */
export function fannedBook(
  index: number,
  step: number,
  shape: BookShape,
  centres: readonly number[],
  s: number,
  twist: number = TWIST_DEG,
): PlacedBook {
  const rise = centres[index] - heightAt(centres, s);
  return { step, top: -rise - shape.thickness / 2, shape: { ...shape, x: 0, z: 0, yaw: relativeYaw(index, s, twist) } };
}
