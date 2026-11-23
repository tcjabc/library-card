/**
 * The book pile seen by an orthographic camera, for the canvas renderer (pure, unit-tested).
 * The same geometry as the CSS 3D version (BookStack.tsx): each book is a box at its place in the
 * pile, nudged and turned by its seeded wobble, then the whole pile is turned by the camera's yaw
 * and tipped by its pitch, with no perspective. A box's faces are parallelograms on screen, so the
 * canvas can draw each with one affine setTransform.
 *
 * Coordinates follow CSS: x to the right, y down (down the pile), z towards the viewer. A book's
 * own axes: u along the spine (left to right), v down through its thickness, s from back to front.
 */
import {
  BOOK_DEPTHS,
  BOOK_WIDTHS,
  MAX_NUDGE_X,
  MAX_NUDGE_Z,
  TILT_X_DEG,
  TILT_Y_DEG,
  layoutWindow,
  type BookShape,
  type StackEntry,
  type StackLayout,
  type StackWindow,
} from './stackModel';

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

/** One book in the pile: its seeded shape and how far its top is from the top of the pile (px). */
export interface PlacedBook {
  step: number;
  top: number;
  shape: BookShape;
}

/** The pile's books, newest (row 0, the top of the pile) first. `entries` and `shapes` are oldest first. */
export function placedBooks(entries: readonly StackEntry[], shapes: readonly BookShape[], layout: StackLayout): PlacedBook[] {
  const out: PlacedBook[] = [];
  for (let row = 0; row < entries.length; row++) {
    const index = entries.length - 1 - row;
    out.push({ step: entries[index].step, top: layout.tops[row], shape: shapes[index] });
  }
  return out;
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

/**
 * How far (px on screen, up or down) a book's corners can be from where its centre's height in
 * the pile puts it, at any yaw: the widest, deepest book with the biggest nudges, tipped by the pitch.
 */
export function pileReach(pitch: number = STACK_CAMERA.pitch): number {
  const halfW = Math.max(...BOOK_WIDTHS) / 2 + MAX_NUDGE_X;
  const halfD = Math.max(...BOOK_DEPTHS) / 2 + MAX_NUDGE_Z;
  return Math.hypot(halfW, halfD) * Math.abs(Math.sin(pitch * RAD));
}

/**
 * Which books (as [start, end) rows, newest first) can show in a viewport `height` px tall whose top
 * is `from` px below the pile's top on screen, plus `buffer` books each way.
 */
export function projectedWindow(layout: StackLayout, from: number, height: number, buffer: number, pitch: number = STACK_CAMERA.pitch): StackWindow {
  const reach = pileReach(pitch);
  const scale = Math.cos(pitch * RAD);
  return layoutWindow(layout, (from - reach) / scale, (from + height + reach) / scale, buffer);
}

/** "Rotate with scroll": one full turn of the camera for this much scrolling (px). */
export const ROTATE_PX_PER_TURN = 2400;

/** The camera's yaw (degrees, in (-180, 180]) for a scroll position, starting from the fixed camera's. */
export function yawForScroll(scrollTop: number, base: number = STACK_CAMERA.yaw): number {
  const turned = base + (Math.max(0, scrollTop) / ROTATE_PX_PER_TURN) * 360;
  const wrapped = ((((turned + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}
