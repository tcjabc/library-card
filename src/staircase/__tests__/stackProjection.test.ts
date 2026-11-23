import { describe, expect, it } from 'vitest';
import { bookShape, generateFakeStack, stackLayout, type BookShape } from '../stackModel';
import {
  ELEVATION_DEG,
  FAN_CAMERA,
  STACK_CAMERA,
  TWIST_DEG,
  bookYaw,
  cameraYaw,
  drawOrder,
  faceCorners,
  faceTransform,
  fannedBook,
  heightAt,
  hitTest,
  pileCentres,
  pointInPolygon,
  projectBook,
  projectPoint,
  relativeYaw,
  type Camera,
  type PlacedBook,
  type Vec2,
  type Vec3,
  type View,
} from '../stackProjection';

// The canvas renderer's camera and geometry (src/staircase/stackProjection.ts).

type Mat = number[][];
const RAD = Math.PI / 180;

// CSS's own transform matrices (column vectors), to check the projection against independently.
function rotateX(deg: number): Mat {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [
    [1, 0, 0, 0],
    [0, c, -s, 0],
    [0, s, c, 0],
    [0, 0, 0, 1],
  ];
}
function rotateY(deg: number): Mat {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [
    [c, 0, s, 0],
    [0, 1, 0, 0],
    [-s, 0, c, 0],
    [0, 0, 0, 1],
  ];
}
function translate(x: number, y: number, z: number): Mat {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1],
  ];
}
function mul(a: Mat, b: Mat): Mat {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)));
}
function apply(m: Mat, p: Vec3): Vec3 {
  const v = [p.x, p.y, p.z, 1];
  const [x, y, z] = m.map((row) => row.reduce((sum, a, k) => sum + a * v[k], 0));
  return { x, y, z };
}

/** Where CSS puts a book's local corner: pile `rotateX rotateY`, then the book's place, `translate3d rotateY`. */
function cssCorner(book: PlacedBook, camera: Camera, local: Vec3): Vec3 {
  const { x, z, yaw, thickness } = book.shape;
  const m = mul(mul(rotateX(camera.pitch), rotateY(camera.yaw)), mul(translate(x, book.top + thickness / 2, z), rotateY(yaw)));
  return apply(m, local);
}

const ORIGIN: View = { camera: STACK_CAMERA, originX: 0, originY: 0 };
const SHAPE: BookShape = { width: 212, depth: 118, thickness: 34, yaw: 4.5, x: -7.2, z: 3.1 };
const BOOK: PlacedBook = { step: 7, top: 300, shape: SHAPE };

function close(a: Vec2, b: Vec2) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe('projectPoint', () => {
  it('matches CSS rotateX(pitch) rotateY(yaw) with no perspective, from the pile’s origin', () => {
    const p = { x: 10, y: 20, z: 30 };
    const css = apply(mul(rotateX(STACK_CAMERA.pitch), rotateY(STACK_CAMERA.yaw)), p);
    const got = projectPoint(p, { camera: STACK_CAMERA, originX: 100, originY: 50 });
    expect(got.x).toBeCloseTo(100 + css.x, 9);
    expect(got.y).toBeCloseTo(50 + css.y, 9);
    expect(got.depth).toBeCloseTo(css.z, 9);
  });

  it('is a plain flat view with no pitch or yaw', () => {
    expect(projectPoint({ x: 3, y: 4, z: 99 }, { camera: { pitch: 0, yaw: 0 }, originX: 1, originY: 2 })).toEqual({ x: 4, y: 6, depth: 99 });
  });
});

describe('projectBook', () => {
  it('with the fixed camera, shows the spine, the cover and the right-hand page edges', () => {
    const faces = projectBook(BOOK, ORIGIN).faces.map((f) => f.side);
    expect(faces.sort()).toEqual(['front', 'right', 'top']);
  });

  it('puts each visible face’s corners where CSS 3D puts them', () => {
    const { width: w, depth: d, thickness: t } = SHAPE;
    const expected: Record<string, Vec3[]> = {
      front: [
        { x: -w / 2, y: -t / 2, z: d / 2 },
        { x: w / 2, y: -t / 2, z: d / 2 },
        { x: w / 2, y: t / 2, z: d / 2 },
        { x: -w / 2, y: t / 2, z: d / 2 },
      ],
      top: [
        { x: -w / 2, y: -t / 2, z: -d / 2 },
        { x: w / 2, y: -t / 2, z: -d / 2 },
        { x: w / 2, y: -t / 2, z: d / 2 },
        { x: -w / 2, y: -t / 2, z: d / 2 },
      ],
      right: [
        { x: w / 2, y: -t / 2, z: d / 2 },
        { x: w / 2, y: -t / 2, z: -d / 2 },
        { x: w / 2, y: t / 2, z: -d / 2 },
        { x: w / 2, y: t / 2, z: d / 2 },
      ],
    };
    const projected = projectBook(BOOK, ORIGIN);
    for (const face of projected.faces) {
      const corners = faceCorners(face);
      expected[face.side].forEach((local, i) => close(corners[i], cssCorner(BOOK, STACK_CAMERA, local)));
    }
    expect(projected.faces.find((f) => f.side === 'front')).toMatchObject({ width: w, height: t });
    expect(projected.faces.find((f) => f.side === 'top')).toMatchObject({ width: w, height: d });
    expect(projected.faces.find((f) => f.side === 'right')).toMatchObject({ width: d, height: t });
  });

  it('known book, camera turned a quarter: the right-hand side faces us, flat on', () => {
    const book: PlacedBook = { step: 1, top: 0, shape: { width: 200, depth: 100, thickness: 40, yaw: 0, x: 0, z: 0 } };
    const { faces } = projectBook(book, { camera: { pitch: 0, yaw: -90 }, originX: 0, originY: 0 });
    expect(faces.map((f) => f.side)).toEqual(['right']);
    const corners = faceCorners(faces[0]);
    [
      { x: -50, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: -50, y: 40 },
    ].forEach((p, i) => close(corners[i], p));
  });

  it('hides faces that turn away as the camera goes round', () => {
    const sides = (yaw: number) =>
      projectBook(BOOK, { ...ORIGIN, camera: { pitch: STACK_CAMERA.pitch, yaw } })
        .faces.map((f) => f.side)
        .sort();
    expect(sides(30)).toEqual(['front', 'left', 'top']);
    // The book is turned 4.5° itself: at 170 we see its back and left; at 180 its right again.
    expect(sides(170)).toEqual(['back', 'left', 'top']);
    expect(sides(180)).toEqual(['back', 'right', 'top']);
    expect(sides(-150)).toEqual(['back', 'right', 'top']);
    for (let yaw = -180; yaw <= 180; yaw += 7.5) {
      const visible = sides(yaw);
      expect(visible).toContain('top');
      expect(visible).not.toContain('bottom');
      expect(visible.length).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the step, the place in the pile and the centre’s depth', () => {
    const projected = projectBook(BOOK, ORIGIN);
    const centre = projectPoint({ x: SHAPE.x, y: BOOK.top + SHAPE.thickness / 2, z: SHAPE.z }, ORIGIN);
    expect(projected).toMatchObject({ step: 7, top: 300 });
    expect(projected.depth).toBeCloseTo(centre.depth, 9);
  });
});

/** A pile under the old fixed camera: newest first, each at its layout place. */
function pile(count: number, seed = 'seed') {
  const entries = generateFakeStack(count, seed);
  const shapes = entries.map((e) => bookShape(seed, e.step));
  const layout = stackLayout(shapes.map((s) => s.thickness));
  const books: PlacedBook[] = layout.tops.map((top, row) => {
    const index = entries.length - 1 - row;
    return { step: entries[index].step, top, shape: shapes[index] };
  });
  return { entries, shapes, layout, books };
}

describe('drawOrder', () => {
  it('paints the bottom of the pile first and the newest book last', () => {
    const { books } = pile(20);
    const order = drawOrder(books.map((b) => projectBook(b, ORIGIN))).map((b) => b.step);
    expect(order).toEqual(books.map((b) => b.step).reverse());
  });

  it('is stable: the same order whatever order the books come in, ties by depth then step', () => {
    const { books } = pile(15);
    const projected = books.map((b) => projectBook(b, ORIGIN));
    const shuffled = [...projected].sort((a, b) => ((a.step * 7919) % 13) - ((b.step * 7919) % 13));
    expect(drawOrder(shuffled).map((b) => b.step)).toEqual(drawOrder(projected).map((b) => b.step));
    const ties = [
      { step: 3, top: 10, depth: 5 },
      { step: 1, top: 10, depth: 5 },
      { step: 2, top: 10, depth: 1 },
      { step: 4, top: 50, depth: 9 },
    ];
    expect(drawOrder(ties).map((b) => b.step)).toEqual([4, 2, 1, 3]);
  });
});

describe('pointInPolygon and hitTest', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('tells inside from outside, for a square and a slanted parallelogram', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
    const slanted = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 15 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 9, y: 6 }, slanted)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 11.5 }, slanted)).toBe(false);
  });

  it('picks the book whose spine is under the point, and nothing off the pile', () => {
    const { books } = pile(8);
    const ordered = drawOrder(books.map((b) => projectBook(b, ORIGIN)));
    for (const book of ordered) {
      const front = book.faces.find((f) => f.side === 'front')!;
      // Just below the middle of the spine's top edge: never under the book above.
      const p = { x: front.origin.x + front.u.x / 2 + front.v.x * 0.6, y: front.origin.y + front.u.y / 2 + front.v.y * 0.6 };
      expect(hitTest(p, ordered)).toBe(book.step);
    }
    expect(hitTest({ x: 5000, y: 5000 }, ordered)).toBeNull();
    expect(hitTest({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('where books overlap on screen, picks the one painted last', () => {
    const below = projectBook({ step: 1, top: 40, shape: SHAPE }, ORIGIN);
    const above = projectBook({ step: 2, top: 6, shape: SHAPE }, ORIGIN);
    const ordered = drawOrder([above, below]);
    const top = below.faces.find((f) => f.side === 'top')!;
    const p = { x: top.origin.x + top.u.x / 2 + top.v.x / 2, y: top.origin.y + top.u.y / 2 + top.v.y / 2 };
    expect(pointInPolygon(p, faceCorners(top))).toBe(true);
    expect(hitTest(p, ordered)).toBe(2);
  });
});

describe('faceTransform', () => {
  it('maps the face’s own corners onto its screen corners, scaled to canvas pixels', () => {
    const face = projectBook(BOOK, { camera: STACK_CAMERA, originX: 180, originY: 40 }).faces.find((f) => f.side === 'right')!;
    const [a, b, c, d, e, f] = faceTransform(face, 2);
    const map = (px: number, py: number) => ({ x: a * px + c * py + e, y: b * px + d * py + f });
    const corners = faceCorners(face).map((p) => ({ x: p.x * 2, y: p.y * 2 }));
    close(map(0, 0), corners[0]);
    close(map(face.width, 0), corners[1]);
    close(map(face.width, face.height), corners[2]);
    close(map(0, face.height), corners[3]);
  });
});

/** A fanned pile at position s: the camera's view of every book, oldest first. */
function fan(count: number, s: number, twist = TWIST_DEG, seed = 'seed') {
  const entries = generateFakeStack(count, seed);
  const shapes = entries.map((e) => bookShape(seed, e.step));
  const centres = pileCentres(shapes.map((sh) => sh.thickness));
  const view: View = { camera: FAN_CAMERA, originX: 0, originY: 0 };
  const books = entries.map((e, i) => fannedBook(i, e.step, shapes[i], centres, s, twist));
  return { entries, shapes, centres, view, books, projected: books.map((b) => projectBook(b, view)) };
}

const sidesOf = (book: { faces: { side: string }[] }) => book.faces.map((f) => f.side).sort();

describe('the fan (stage 2a)', () => {
  it('turns the centre book square-on and each neighbour TWIST further', () => {
    expect(relativeYaw(40, 40)).toBe(0);
    expect(relativeYaw(41, 40)).toBe(TWIST_DEG);
    expect(relativeYaw(39, 40)).toBe(-TWIST_DEG);
    expect(relativeYaw(43, 40.5, 12)).toBe(30);
    expect(bookYaw(7, 10)).toBe(70);
    const { books } = fan(60, 30);
    expect(books[30].shape.yaw).toBe(0);
    expect(books[31].shape.yaw).toBe(TWIST_DEG);
    expect(books[29].shape.yaw).toBe(-TWIST_DEG);
  });

  it('turns the camera steadily as s rises', () => {
    let last = -Infinity;
    for (let s = 0; s <= 50; s += 0.25) {
      const yaw = cameraYaw(s);
      expect(yaw).toBeGreaterThan(last);
      last = yaw;
    }
    expect(cameraYaw(3, 0)).toBe(0);
  });

  it('drops the seeded nudges and keeps the seeded size', () => {
    const { books, shapes } = fan(20, 10);
    books.forEach((b, i) => {
      expect(b.shape).toMatchObject({ x: 0, z: 0, width: shapes[i].width, depth: shapes[i].depth, thickness: shapes[i].thickness });
    });
  });

  it('puts the centre book in the middle of the screen, the ones above higher up', () => {
    const { centres, projected, books } = fan(30, 12);
    expect(heightAt(centres, 12)).toBe(centres[12]);
    expect(books[12].top + books[12].shape.thickness / 2).toBeCloseTo(0, 9);
    const front = projected[12].faces.find((f) => f.side === 'front')!;
    // Square-on: the spine is an upright rectangle, centred on the origin's x.
    expect(front.u.y).toBeCloseTo(0, 9);
    expect(front.v.x).toBeCloseTo(0, 9);
    expect(front.origin.x + front.u.x / 2).toBeCloseTo(0, 9);
    expect(front.u.x).toBeCloseTo(books[12].shape.width, 9);
    expect(front.v.y).toBeCloseTo(books[12].shape.thickness * Math.cos(ELEVATION_DEG * RAD), 9);
    const centreY = (i: number) => projectPoint({ x: 0, y: books[i].top + books[i].shape.thickness / 2, z: 0 }, fan(30, 12).view).y;
    expect(centreY(13)).toBeLessThan(centreY(12));
    expect(centreY(11)).toBeGreaterThan(centreY(12));
  });

  it('follows the spec’s projection for a rotated corner', () => {
    const shape: BookShape = { width: 200, depth: 100, thickness: 30, x: 0, z: 0, yaw: 0 };
    const centres = pileCentres([30, 30, 30]);
    const book = fannedBook(2, 3, shape, centres, 1, 10); // one book above the centre: rel = 10°
    const front = projectBook(book, { camera: FAN_CAMERA, originX: 0, originY: 0 }).faces.find((f) => f.side === 'front')!;
    const rel = 10 * RAD;
    const e = ELEVATION_DEG * RAD;
    // Its spine's top-left corner: local (-w/2, top, +d/2), its centre 30 px above the origin.
    const [x, y, z] = [-100, 30 + 15, 50];
    const xr = x * Math.cos(rel) + z * Math.sin(rel);
    const zr = -x * Math.sin(rel) + z * Math.cos(rel);
    expect(front.origin.x).toBeCloseTo(xr, 9);
    expect(front.origin.y).toBeCloseTo(-y * Math.cos(e) + zr * Math.sin(e), 9);
  });

  it('shows the spine when cos(rel) > 0, the fore-edge when cos(rel) < 0, and the side by sin(rel)', () => {
    const shape: BookShape = { width: 200, depth: 110, thickness: 34, x: 0, z: 0, yaw: 0 };
    const at = (rel: number) =>
      sidesOf(projectBook({ step: 1, top: 0, shape: { ...shape, yaw: rel } }, { camera: FAN_CAMERA, originX: 0, originY: 0 }));
    expect(at(0)).toEqual(['front', 'top']);
    expect(at(30)).toEqual(['front', 'left', 'top']);
    expect(at(-30)).toEqual(['front', 'right', 'top']);
    expect(at(120)).toEqual(['back', 'left', 'top']);
    expect(at(-120)).toEqual(['back', 'right', 'top']);
    expect(at(180)).toEqual(['back', 'top']);
    for (let rel = -175; rel <= 175; rel += 5) {
      const sides = at(rel);
      const c = Math.cos(rel * RAD);
      const sn = Math.sin(rel * RAD);
      expect(sides).toContain('top');
      expect(sides.includes('front')).toBe(c > 1e-9);
      expect(sides.includes('back')).toBe(c < -1e-9);
      expect(sides.includes('left')).toBe(sn > 1e-9);
      expect(sides.includes('right')).toBe(sn < -1e-9);
    }
  });

  it('draws from the bottom of the pile to the top', () => {
    const { projected, entries } = fan(40, 17.3);
    const order = drawOrder([...projected].reverse()).map((b) => b.step);
    expect(order).toEqual(entries.map((e) => e.step));
  });

  it('hit-tests turned books: the spine under the point, the top book where they overlap', () => {
    const { projected, books } = fan(30, 15.4, 12);
    const ordered = drawOrder(projected);
    for (const i of [13, 14, 15, 16, 17]) {
      const front = projected[i].faces.find((f) => f.side === 'front')!;
      const p = { x: front.origin.x + front.u.x / 2 + front.v.x * 0.6, y: front.origin.y + front.u.y / 2 + front.v.y * 0.6 };
      expect(hitTest(p, ordered)).toBe(books[i].step);
    }
    // Just under the centre spine's top edge, the book above (painted later) overhangs it: that one wins.
    const centre = projected[15].faces.find((f) => f.side === 'front')!;
    const p = { x: centre.origin.x + centre.u.x / 2 + centre.v.x * 0.03, y: centre.origin.y + centre.u.y / 2 + centre.v.y * 0.03 };
    expect(pointInPolygon(p, faceCorners(centre))).toBe(true);
    expect(projected[16].faces.some((f) => pointInPolygon(p, faceCorners(f)))).toBe(true);
    expect(hitTest(p, ordered)).toBe(books[16].step);
    expect(hitTest({ x: 4000, y: 0 }, ordered)).toBeNull();
  });
});

describe('pileCentres and heightAt', () => {
  it('interpolates the height between book centres and clamps at the ends', () => {
    const centres = pileCentres([20, 40, 30]);
    expect(centres).toEqual([10, 40, 75]);
    expect(heightAt(centres, 0.5)).toBe(25);
    expect(heightAt(centres, 1.5)).toBe(57.5);
    expect(heightAt(centres, -2)).toBe(10);
    expect(heightAt(centres, 9)).toBe(75);
    expect(heightAt([], 3)).toBe(0);
  });
});
