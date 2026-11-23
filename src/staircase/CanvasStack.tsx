import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SETTLE_IDLE_MS, clampPosition, positionToScroll, scrollHeight, scrollToPosition, settleTarget, stepCamera } from './camera';
import { LruCache, backingSize, canvasScale, cssLength, fitWithEllipsis } from './canvasHelpers';
import {
  DECIDE_AFTER_MS,
  FAN_CAP,
  faceSpan,
  faceThickness,
  insetDue,
  nextScale,
  pageDetail,
  tagChanged,
  visibleRange,
  type InsetState,
} from './drawBudget';
import { BOOK_DEPTHS, BOOK_WIDTHS, bookShape, type StackEntry } from './stackModel';
import {
  FAN_CAMERA,
  TWIST_DEG,
  cameraYaw,
  faceTransform,
  fannedBook,
  pileCentres,
  projectBook,
  relativeYaw,
  type ProjectedBook,
  type ProjectedFace,
  type View,
} from './stackProjection';
import './bookStack.css';
import './canvasStack.css';

/**
 * The book pile drawn on one canvas (developer tools only). Stage 2a, "books that face the
 * reader": the camera's position is a continuous book index; the book there faces the reader
 * square-on and its neighbours fan out by the twist per book (stackProjection.ts), so the books
 * near the middle of the screen are always readable.
 *
 * A native scroll area with a sized spacer keeps the browser's own (inertia) scrolling, and sets
 * where the camera is going; the drawn position eases towards it (camera.ts). When scrolling
 * stops, the camera settles on the nearest book and the scroll offset is moved to match. The
 * canvas sits over the scroll area, out of the way of touches; frames run only while the camera
 * moves (no idle loop), and with prefers-reduced-motion the camera jumps instead of easing.
 *
 * Per frame (drawBudget.ts): only the books on screen plus one spare each way are drawn (at most
 * FAN_CAP either side), bottom to top; each spine and each thickness of page edge is drawn once
 * to a small canvas and reused, and far or edge-on page edges are a flat fill. The canvas is
 * opaque (filled with the page's background), and if frames are slow it steps its resolution
 * down for the rest of the visit. The tag and the top-down inset only redraw when they change.
 */

/** The centre book, for the overlay tag. */
export interface CentreBook {
  title: string;
  avatar: string;
  /** How far it is turned from the reader (whole degrees). */
  degrees: number;
}

/** The overlay tag's two lines: the book (cut to one line) and how far it is turned. */
export interface CentreTag {
  book: string;
  turned: string;
}

/** What one frame drew, for the measurement panel. */
export interface DrawStats {
  /** How long the drawing took (ms). */
  ms: number;
  /** Faces drawn. */
  faces: number;
  /** Canvas drawing calls (fills, strokes, clears and drawImage). */
  ops: number;
  /** The canvas's backing size (px) and its pixels per CSS px. */
  width: number;
  height: number;
  scale: number;
  /** "Measure raster" only, on sampled frames: how long a 1×1 read-back took (ms), forcing the GPU to finish. */
  raster?: number;
}

export interface CanvasStackProps {
  /** Oldest first. */
  entries: readonly StackEntry[];
  /** Seeds each book's size (the household id, later). */
  seed: string;
  /** Degrees each book is turned more than the one under it. */
  twist?: number;
  /** Come to rest square-on to a book when scrolling stops. */
  settle?: boolean;
  /** Draw the top-down view of the fan in a small corner box (developer tools). */
  inset?: boolean;
  /** The overlay tag's text for the centre book; no tag without it. */
  describeCentre?: (centre: CentreBook) => CentreTag;
  /** Time a forced GPU flush on about every RASTER_EVERY-th moving frame (developer tools). */
  measureRaster?: boolean;
  /** The scroll area's name. */
  label: string;
  /** The scroll area, for measuring. */
  onScroller?: (el: HTMLDivElement | null) => void;
  /** Each scroll by the reader (not the settle's own scroll). */
  onScroll?: () => void;
  /** What each frame drew. */
  onDraw?: (stats: DrawStats) => void;
}

/** Spine labels kept ready to draw. */
const LABEL_CACHE_SIZE = 100;
/** The settle's own scroll is ignored this close to where it put the scroll offset (px). */
const OWN_SCROLL_SLACK = 1;
/** …and stops being expected after this long (ms), in case the browser sends no scroll event. */
const OWN_SCROLL_MS = 300;
/** "Measure raster": time a flush on every this-many-th moving frame. */
const RASTER_EVERY = 10;
/** The inset shows this many books either side of the centre one at most. */
const INSET_EACH_WAY = 10;
const RAD = Math.PI / 180;
/** The inset fits the biggest footprint at any turn. */
const INSET_SPAN = Math.hypot(Math.max(...BOOK_WIDTHS), Math.max(...BOOK_DEPTHS));

/** Canvas drawing calls this frame (fills, strokes, clears, drawImage), for the panel. */
let ops = 0;

/** The book tokens from theme.css, read once from the page. */
interface BookTheme {
  spineSaturation: string;
  spineLightness: string;
  coverLightness: string;
  bandSaturation: string;
  bandLightness: string;
  onBook: string;
  pages: string;
  pageLine: string;
  shade: string;
  bandWidth: number;
  stripePaper: number;
  stripeLine: number;
  /** The spine's gap between band, avatar and title, and its padding after the title (px). */
  gap: number;
  titleFont: string;
  avatarFont: string;
  /** The inset's lines (px) and colours. */
  borderThin: number;
  borderThick: number;
  insetLine: string;
  insetHighlight: string;
  /** The page behind the pile: the canvas is opaque and fills itself with this. */
  background: string;
}

function readTheme(): BookTheme {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const remPx = parseFloat(css.fontSize) || 16;
  const px = (name: string) => cssLength(v(name), remPx);
  return {
    spineSaturation: v('--book-spine-saturation'),
    spineLightness: v('--book-spine-lightness'),
    coverLightness: v('--book-cover-lightness'),
    bandSaturation: v('--book-band-saturation'),
    bandLightness: v('--book-band-lightness'),
    onBook: v('--color-on-book'),
    pages: v('--color-book-pages'),
    pageLine: v('--color-book-page-line'),
    shade: v('--color-book-shade'),
    bandWidth: px('--book-band-width'),
    stripePaper: px('--book-page-stripe-paper'),
    stripeLine: px('--book-page-stripe-line'),
    gap: px('--space-2'),
    titleFont: `${v('--weight-bold')} ${px('--text-sm')}px ${v('--font-body')}`,
    avatarFont: `${px('--text-md')}px ${v('--font-emoji')}`,
    borderThin: px('--border-thin'),
    borderThick: px('--border-thick'),
    insetLine: v('--color-text-muted'),
    insetHighlight: v('--color-text'),
    background: v('--color-bg'),
  };
}

function hsl(hue: number, saturation: string, lightness: string): string {
  return `hsl(${hue}, ${saturation}, ${lightness})`;
}

interface BookPaint {
  title: string;
  avatar: string;
  spineHue: number;
  readerHue: number;
  width: number;
  thickness: number;
  cover: string;
  /** The reader's colour. */
  band: string;
}

/** The main canvas's context: opaque, so the compositor needn't blend it with the page. */
function context2d(canvas: HTMLCanvasElement | null, opaque: boolean): CanvasRenderingContext2D | null {
  return canvas?.getContext('2d', opaque ? { alpha: false } : undefined) ?? null;
}

/** A spine at `scale` canvas pixels per px: the book's colour and shade, the reader's band and avatar, then the title. */
function renderSpine(book: BookPaint, theme: BookTheme, scale: number): HTMLCanvasElement {
  const { width: w, thickness: t } = book;
  const canvas = document.createElement('canvas');
  canvas.width = backingSize(w, scale);
  canvas.height = backingSize(t, scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(canvas.width / w, canvas.height / t);
  ctx.fillStyle = hsl(book.spineHue, theme.spineSaturation, theme.spineLightness);
  ctx.fillRect(0, 0, w, t);
  const shade = ctx.createLinearGradient(0, 0, 0, t);
  shade.addColorStop(0.55, 'transparent');
  shade.addColorStop(1, theme.shade);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, t);
  ctx.fillStyle = hsl(book.readerHue, theme.bandSaturation, theme.bandLightness);
  ctx.fillRect(0, 0, theme.bandWidth, t);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.onBook;
  let x = theme.bandWidth + theme.gap;
  ctx.font = theme.avatarFont;
  ctx.fillText(book.avatar, x, t / 2);
  x += ctx.measureText(book.avatar).width + theme.gap;
  ctx.font = theme.titleFont;
  const title = fitWithEllipsis(book.title, w - x - theme.gap, (s) => ctx.measureText(s).width);
  ctx.fillText(title, x, t / 2);
  return canvas;
}

/**
 * Page-edge stripes for one book thickness, drawn once: a strip of paper then a thin line,
 * repeated down the edge, as tall as the book (so thicker books have more stripes). It is two
 * pixels wide and stretched across each face by drawImage, since the stripes run along the face.
 */
function renderPages(thickness: number, theme: BookTheme, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = backingSize(thickness, scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = theme.pages;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const repeat = theme.stripePaper + theme.stripeLine;
  if (!(repeat > 0) || !(theme.stripeLine > 0)) return canvas;
  ctx.fillStyle = theme.pageLine;
  const k = canvas.height / thickness;
  const line = Math.max(1, Math.round(theme.stripeLine * k));
  for (let y = theme.stripePaper; y < thickness; y += repeat) ctx.fillRect(0, Math.round(y * k), canvas.width, line);
  return canvas;
}

interface Paint {
  /** Page-edge stripes, by book thickness. */
  pages: Map<number, HTMLCanvasElement>;
  coverShade: CanvasGradient | null;
  scale: number;
}

/** What drawing one face needs besides the face. */
interface FaceKit {
  scale: number;
  labels: LruCache<number, HTMLCanvasElement>;
  theme: BookTheme;
  paint: Paint;
}

/** A face's parallelogram as a path, in screen px (the context set to `scale`). */
function tracePath(ctx: CanvasRenderingContext2D, face: ProjectedFace) {
  const { origin: o, u, v } = face;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + u.x, o.y + u.y);
  ctx.lineTo(o.x + u.x + v.x, o.y + u.y + v.y);
  ctx.lineTo(o.x + v.x, o.y + v.y);
  ctx.closePath();
}

/** One face of one book, through the face's affine transform. `fromCamera` is the book's distance from the camera (books). */
function drawFace(ctx: CanvasRenderingContext2D, face: ProjectedFace, step: number, book: BookPaint, fromCamera: number, kit: FaceKit) {
  const { scale, labels, theme, paint } = kit;
  if (face.side === 'front') {
    let spine = labels.get(step);
    if (!spine) {
      spine = renderSpine(book, theme, scale);
      labels.set(step, spine);
    }
    ctx.setTransform(...faceTransform(face, scale));
    ctx.drawImage(spine, 0, 0, face.width, face.height);
    ops += 1;
  } else if (face.side === 'top' || face.side === 'bottom') {
    // In the face's unit square, so the one cover gradient fits every book.
    ctx.setTransform(face.u.x * scale, face.u.y * scale, face.v.x * scale, face.v.y * scale, face.origin.x * scale, face.origin.y * scale);
    ctx.fillStyle = book.cover;
    ctx.fillRect(0, 0, 1, 1);
    ops += 1;
    if (face.side === 'top' && paint.coverShade) {
      ctx.fillStyle = paint.coverShade;
      ctx.fillRect(0, 0, 1, 1);
      ops += 1;
    }
  } else if (pageDetail(fromCamera, faceThickness(face)) === 'striped') {
    // Page edges up close: the cached stripes, one drawImage.
    let pages = paint.pages.get(book.thickness);
    if (!pages) {
      pages = renderPages(book.thickness, theme, scale);
      paint.pages.set(book.thickness, pages);
    }
    ctx.setTransform(...faceTransform(face, scale));
    ctx.drawImage(pages, 0, 0, face.width, face.height);
    ops += 1;
  } else {
    // Far away or edge-on: paper colour and an outline.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    tracePath(ctx, face);
    ctx.fillStyle = theme.pages;
    ctx.fill();
    ctx.strokeStyle = theme.pageLine;
    ctx.lineWidth = theme.borderThin;
    ctx.stroke();
    ops += 2;
  }
}

interface Size {
  /** The scroll area (CSS px), measured on resize only. */
  width: number;
  height: number;
  scale: number;
  /** The inset's side (px), 0 without it. */
  inset: number;
}

/**
 * The top-down view: each drawn book's footprint turned by its relative yaw, the spine edge (the
 * side facing the reader, at the bottom) in the reader's colour, and the centre book filled in.
 */
function drawInset(
  ctx: CanvasRenderingContext2D,
  side: number,
  scale: number,
  from: number,
  to: number,
  s: number,
  twist: number,
  centre: number,
  shapes: readonly { width: number; depth: number }[],
  paints: readonly BookPaint[],
  theme: BookTheme,
) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, side, side);
  const mid = side / 2;
  const k = (side - 2 * theme.gap) / INSET_SPAN;
  const footprint = (index: number) => {
    const { width: w, depth: d } = shapes[index];
    const yaw = relativeYaw(index, s, twist) * RAD;
    const c = Math.cos(yaw) * k;
    const sn = Math.sin(yaw) * k;
    // x across, z towards the reader (down here): back-left, back-right, front-right, front-left.
    const px = (x: number, z: number) => mid + x * c + z * sn;
    const pz = (x: number, z: number) => mid - x * sn + z * c;
    ctx.beginPath();
    ctx.moveTo(px(-w / 2, -d / 2), pz(-w / 2, -d / 2));
    ctx.lineTo(px(w / 2, -d / 2), pz(w / 2, -d / 2));
    ctx.lineTo(px(w / 2, d / 2), pz(w / 2, d / 2));
    ctx.lineTo(px(-w / 2, d / 2), pz(-w / 2, d / 2));
    ctx.closePath();
    return { px, pz, w, d };
  };
  const spineEdge = (f: ReturnType<typeof footprint>, index: number) => {
    ctx.beginPath();
    ctx.moveTo(f.px(-f.w / 2, f.d / 2), f.pz(-f.w / 2, f.d / 2));
    ctx.lineTo(f.px(f.w / 2, f.d / 2), f.pz(f.w / 2, f.d / 2));
    ctx.strokeStyle = paints[index].band;
    ctx.lineWidth = theme.borderThick;
    ctx.stroke();
  };
  for (let i = from; i < to; i++) {
    if (i === centre) continue;
    const f = footprint(i);
    ctx.strokeStyle = theme.insetLine;
    ctx.lineWidth = theme.borderThin;
    ctx.stroke();
    spineEdge(f, i);
  }
  if (centre >= from && centre < to) {
    const f = footprint(centre);
    ctx.fillStyle = paints[centre].cover;
    ctx.fill();
    ctx.strokeStyle = theme.insetHighlight;
    ctx.lineWidth = theme.borderThick;
    ctx.stroke();
    spineEdge(f, centre);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function CanvasStack({
  entries,
  seed,
  twist = TWIST_DEG,
  settle = true,
  inset = false,
  describeCentre,
  measureRaster = false,
  label,
  onScroller,
  onScroll,
  onDraw,
}: CanvasStackProps) {
  const count = entries.length;
  const shapes = useMemo(() => entries.map((e) => bookShape(seed, e.step)), [entries, seed]);
  const centres = useMemo(() => pileCentres(shapes.map((s) => s.thickness)), [shapes]);
  const [theme] = useState(readTheme);
  // Oldest first, like `entries`.
  const paints = useMemo<BookPaint[]>(
    () =>
      entries.map((entry, i) => ({
        title: entry.title,
        avatar: entry.avatar,
        spineHue: entry.spineHue,
        readerHue: entry.readerHue,
        width: shapes[i].width,
        thickness: shapes[i].thickness,
        cover: hsl(entry.spineHue, theme.spineSaturation, theme.coverLightness),
        band: hsl(entry.readerHue, theme.bandSaturation, theme.bandLightness),
      })),
    [entries, shapes, theme],
  );
  const labels = useMemo(() => new LruCache<number, HTMLCanvasElement>(LABEL_CACHE_SIZE), []);

  const scroller = useRef<HTMLDivElement | null>(null);
  const sizer = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const insetCanvas = useRef<HTMLCanvasElement | null>(null);
  const tagBook = useRef<HTMLSpanElement | null>(null);
  const tagTurned = useRef<HTMLSpanElement | null>(null);
  const size = useRef<Size>({ width: 0, height: 0, scale: 1, inset: 0 });
  const paint = useRef<Paint>({ pages: new Map(), coverShade: null, scale: 0 });
  /** This frame's projected books, by offset from the centre book minus FAN_CAP (reused every frame). */
  const scratch = useRef<(ProjectedBook | null)[]>(Array.from({ length: 2 * FAN_CAP + 1 }, () => null));
  /** Where the camera is going and where it's drawn (book positions), and the frame loop's state. */
  const cam = useRef({
    target: Math.max(0, count - 1),
    shown: Math.max(0, count - 1),
    last: 0,
    raf: 0,
    settleTimer: 0,
    /** Settling: when the ease ends, move the scroll offset to match. */
    settling: false,
    /** The scroll offset the settle set, so its scroll event is ignored. */
    expected: null as number | null,
    expectedTimer: 0,
    /** The scroll offset at the last scroll event (so the frame loop never reads layout). */
    scrollTop: 0,
    reduced: false,
    /** Frames drawn (for the inset's throttle and raster sampling). */
    frame: 0,
    /** Moving frames since the last resolution decision, and their time (ms). */
    motionFrames: 0,
    motionMs: 0,
    /** The resolution never goes back above this once stepped down (this visit). */
    scaleCap: Infinity,
    tag: null as { step: number; degrees: number } | null,
    inset: null as InsetState | null,
  });
  // What the next frame draws: kept in a ref so scrolling never waits on React.
  const scene = useRef({ entries, shapes, centres, paints, twist, settle, describeCentre, measureRaster, onDraw });
  useLayoutEffect(() => {
    scene.current = { entries, shapes, centres, paints, twist, settle, describeCentre, measureRaster, onDraw };
  });

  /** Size the canvases' backing stores for the scroll area at `scale` (no layout reads). */
  const applyScale = useCallback((scale: number) => {
    const c = canvas.current;
    if (!c) return;
    const { width, height, inset: side } = size.current;
    size.current.scale = scale;
    c.width = backingSize(width, scale);
    c.height = backingSize(height, scale);
    const insetEl = insetCanvas.current;
    if (insetEl && side > 0) {
      insetEl.width = backingSize(side, scale);
      insetEl.height = backingSize(side, scale);
    }
    cam.current.inset = null;
  }, []);

  /** One frame. `settled`: the camera has stopped, so the overlays catch up whatever their throttle. */
  const draw = useCallback(
    (settled: boolean) => {
      const ctx = context2d(canvas.current, true);
      if (!ctx) return;
      const started = performance.now();
      ops = 0;
      const c = cam.current;
      const { width, height, scale } = size.current;
      const { entries, shapes, centres, paints, twist, describeCentre, measureRaster, onDraw } = scene.current;
      if (paint.current.scale !== scale) {
        labels.clear();
        // The cover's shade runs across a face's unit square, towards the spine.
        const coverShade = ctx.createLinearGradient(0, 0, 0, 1);
        coverShade.addColorStop(0.6, 'transparent');
        coverShade.addColorStop(1, theme.shade);
        paint.current = { pages: new Map(), coverShade, scale };
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ops += 1;

      const s = c.shown;
      const total = entries.length;
      let faces = 0;
      let from = 0;
      let to = 0;
      const centre = total > 0 ? Math.round(clampPosition(s, total)) : -1;
      if (centre >= 0) {
        const view: View = { camera: FAN_CAMERA, originX: width / 2, originY: height / 2 };
        const books = scratch.current;
        books.fill(null);
        const base = centre - FAN_CAP;
        const projectAt = (i: number): ProjectedBook => {
          let book = books[i - base];
          if (!book) {
            book = projectBook(fannedBook(i, entries[i].step, shapes[i], centres, s, twist), view);
            books[i - base] = book;
          }
          return book;
        };
        const range = visibleRange(centre, total, (i) => {
          const span = faceSpan(projectAt(i).faces);
          return span.bottom >= 0 && span.top <= height;
        });
        from = range.start;
        to = range.end;
        const kit: FaceKit = { scale, labels, theme, paint: paint.current };
        // Bottom of the pile first: index order is painter's order (stackProjection's drawOrder).
        for (let i = from; i < to; i++) {
          const book = projectAt(i);
          // Ready each spine as its book comes into the window, even facing away, so a turn of
          // the fan never has many spines to draw in one frame.
          if (!labels.get(book.step)) labels.set(book.step, renderSpine(paints[i], theme, scale));
          for (const face of book.faces) drawFace(ctx, face, book.step, paints[i], i - s, kit);
          faces += book.faces.length;
        }
      }

      let raster: number | undefined;
      c.frame += 1;
      if (measureRaster && !settled && c.frame % RASTER_EVERY === 0) {
        const flushStart = performance.now();
        ctx.getImageData(0, 0, 1, 1);
        raster = performance.now() - flushStart;
      }

      if (centre >= 0) {
        const insetCtx = size.current.inset > 0 ? insetCanvas.current?.getContext('2d') : null;
        const next: InsetState = { centre, angle: cameraYaw(s, twist), frame: c.frame };
        if (insetCtx && insetDue(c.inset, next, settled ? 0 : undefined)) {
          drawInset(
            insetCtx,
            size.current.inset,
            scale,
            Math.max(from, centre - INSET_EACH_WAY),
            Math.min(to, centre + INSET_EACH_WAY + 1),
            s,
            twist,
            centre,
            shapes,
            paints,
            theme,
          );
          c.inset = next;
        }
        if (tagBook.current && tagTurned.current && describeCentre) {
          const entry = entries[centre];
          const degrees = Math.round(Math.abs(relativeYaw(centre, s, twist)));
          if (tagChanged(c.tag, entry.step, degrees)) {
            c.tag = { step: entry.step, degrees };
            const text = describeCentre({ title: entry.title, avatar: entry.avatar, degrees });
            tagBook.current.textContent = text.book;
            tagTurned.current.textContent = text.turned;
          }
        }
      }
      onDraw?.({ ms: performance.now() - started, faces, ops, width: ctx.canvas.width, height: ctx.canvas.height, scale, raster });
    },
    [labels, theme],
  );

  /** Run the camera: one frame at a time (ease, draw) until it arrives, then stop. */
  const run = useCallback(() => {
    const c = cam.current;
    if (c.raf) return;
    const tick = (now: number) => {
      c.raf = 0;
      const moving = c.last > 0;
      const dt = moving ? now - c.last : 1000 / 60;
      c.last = now;
      const next = stepCamera(c.shown, c.target, dt, c.reduced);
      c.shown = next.shown;
      // Slow frames for a second of motion: step the resolution down (never back up). Not while
      // "Measure raster" is on: its read-backs slow the canvas themselves.
      if (moving && !scene.current.measureRaster) {
        c.motionFrames += 1;
        c.motionMs += dt;
        if (c.motionMs >= DECIDE_AFTER_MS) {
          const scale = nextScale(size.current.scale, c.motionMs / c.motionFrames, c.motionFrames);
          c.motionFrames = 0;
          c.motionMs = 0;
          if (scale < size.current.scale) {
            c.scaleCap = scale;
            applyScale(scale);
          }
        }
      }
      draw(next.done);
      if (!next.done) {
        c.raf = requestAnimationFrame(tick);
        return;
      }
      c.last = 0;
      if (c.settling) {
        c.settling = false;
        const el = scroller.current;
        const top = positionToScroll(c.shown, scene.current.entries.length);
        if (el && Math.abs(c.scrollTop - top) >= OWN_SCROLL_SLACK / 2) {
          c.expected = top;
          window.clearTimeout(c.expectedTimer);
          c.expectedTimer = window.setTimeout(() => (cam.current.expected = null), OWN_SCROLL_MS);
          el.scrollTop = top;
          c.scrollTop = top;
        }
      }
    };
    c.raf = requestAnimationFrame(tick);
  }, [applyScale, draw]);

  /** Scrolling has stopped: come to rest on the nearest book. */
  const settleNow = useCallback(() => {
    const c = cam.current;
    if (!scene.current.settle) return;
    const total = scene.current.entries.length;
    c.target = settleTarget(scrollToPosition(c.scrollTop, total), total);
    c.settling = true;
    run();
  }, [run]);

  // Size the canvases to the scroll area (backing at up to 2x, or lower once stepped down) and
  // the spacer to the pile, now and on every resize, rotation or zoom, and draw straight away
  // so the first frame isn't empty.
  useLayoutEffect(() => {
    const el = scroller.current;
    const c = canvas.current;
    if (!el || !c) return;
    let media: MediaQueryList | null = null;
    const fit = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const insetEl = insetCanvas.current;
      size.current = { width, height, scale: size.current.scale, inset: insetEl ? insetEl.clientWidth : 0 };
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      applyScale(Math.min(canvasScale(window.devicePixelRatio), cam.current.scaleCap));
      if (sizer.current) sizer.current.style.height = `${scrollHeight(scene.current.entries.length, height)}px`;
      draw(true);
    };
    const watchScale = () => {
      media?.removeEventListener('change', onScale);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener('change', onScale);
    };
    const onScale = () => {
      watchScale();
      fit();
    };
    const camState = cam.current;
    camState.scrollTop = el.scrollTop;
    camState.target = camState.shown = scrollToPosition(camState.scrollTop, scene.current.entries.length);
    fit();
    watchScale();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    return () => {
      resize.disconnect();
      media?.removeEventListener('change', onScale);
      cancelAnimationFrame(camState.raf);
      camState.raf = 0;
      window.clearTimeout(camState.settleTimer);
      window.clearTimeout(camState.expectedTimer);
    };
  }, [applyScale, draw]);

  // prefers-reduced-motion: no easing (followed live).
  useEffect(() => {
    const c = cam.current;
    c.reduced = prefersReducedMotion();
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => (cam.current.reduced = media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // A new twist, tag or inset: draw again where the camera is (unless a frame is coming anyway).
  useEffect(() => {
    if (!cam.current.raf) draw(true);
  }, [draw, twist, describeCentre, inset]);

  const handleScroll = () => {
    const c = cam.current;
    const el = scroller.current;
    if (!el) return;
    c.scrollTop = el.scrollTop;
    if (c.expected !== null && Math.abs(c.scrollTop - c.expected) < OWN_SCROLL_SLACK) {
      // The settle's own scroll: the camera is already there.
      c.expected = null;
      return;
    }
    c.expected = null;
    onScroll?.();
    c.target = scrollToPosition(c.scrollTop, scene.current.entries.length);
    c.settling = false;
    window.clearTimeout(c.settleTimer);
    if (scene.current.settle) c.settleTimer = window.setTimeout(settleNow, SETTLE_IDLE_MS);
    // Drawing happens in the frame loop only: one draw per frame however many scroll events arrive.
    run();
  };

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      onScroller?.(el);
    },
    [onScroller],
  );

  return (
    <div className="canvas-stack">
      <div
        ref={setScroller}
        className="book-stack canvas-stack__scroller"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div ref={sizer} className="book-stack__sizer" style={{ height: scrollHeight(count, 0) }} />
      </div>
      <canvas ref={canvas} className="canvas-stack__canvas" aria-hidden="true" />
      {describeCentre && (
        <p className="canvas-stack__tag">
          <span ref={tagBook} className="canvas-stack__tag-book" />
          <span ref={tagTurned} className="canvas-stack__tag-turned" />
        </p>
      )}
      {inset && <canvas ref={insetCanvas} className="canvas-stack__inset" aria-hidden="true" />}
    </div>
  );
}

export default memo(CanvasStack);
