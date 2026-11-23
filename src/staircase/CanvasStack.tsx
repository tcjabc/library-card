import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SETTLE_IDLE_MS, clampPosition, positionToScroll, scrollHeight, scrollToPosition, settleTarget, stepCamera } from './camera';
import { LruCache, backingSize, canvasScale, cssLength, fitWithEllipsis } from './canvasHelpers';
import { BOOK_DEPTHS, BOOK_WIDTHS, bookShape, type StackEntry } from './stackModel';
import {
  FAN_CAMERA,
  FAN_MIN_EACH_WAY,
  TWIST_DEG,
  drawOrder,
  faceTransform,
  fanWindow,
  fannedBook,
  pileCentres,
  projectBook,
  relativeYaw,
  type ProjectedBook,
  type ProjectedFace,
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
 * moves (no idle loop), and with prefers-reduced-motion the camera jumps instead of easing. Each
 * spine's label is drawn once to a small canvas and reused.
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
  /** The scroll area's name. */
  label: string;
  /** The scroll area, for measuring. */
  onScroller?: (el: HTMLDivElement | null) => void;
  /** Each scroll by the reader (not the settle's own scroll). */
  onScroll?: () => void;
  /** How long each frame's drawing took (ms). */
  onDraw?: (ms: number) => void;
}

/** Spine labels kept ready to draw. */
const LABEL_CACHE_SIZE = 100;
/** The settle's own scroll is ignored this close to where it put the scroll offset (px). */
const OWN_SCROLL_SLACK = 1;
/** …and stops being expected after this long (ms), in case the browser sends no scroll event. */
const OWN_SCROLL_MS = 300;
const RAD = Math.PI / 180;
/** The inset fits the biggest footprint at any turn. */
const INSET_SPAN = Math.hypot(Math.max(...BOOK_WIDTHS), Math.max(...BOOK_DEPTHS));

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

/** The page edges' stripes, as a pattern in a face's own px. */
function pagesPattern(ctx: CanvasRenderingContext2D, theme: BookTheme, scale: number): CanvasPattern | string {
  const repeat = theme.stripePaper + theme.stripeLine;
  if (!(repeat > 0)) return theme.pages;
  const tile = document.createElement('canvas');
  tile.width = 1;
  tile.height = backingSize(repeat, scale);
  const t = tile.getContext('2d');
  if (!t) return theme.pages;
  t.fillStyle = theme.pages;
  t.fillRect(0, 0, 1, tile.height);
  t.fillStyle = theme.pageLine;
  const line = backingSize(theme.stripeLine, scale);
  t.fillRect(0, tile.height - line, 1, line);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return theme.pages;
  pattern.setTransform?.(new DOMMatrix().scale(repeat / tile.height));
  return pattern;
}

interface Paint {
  pattern: CanvasPattern | string | null;
  coverShade: CanvasGradient | null;
  scale: number;
}

/** One face of one book, through the face's affine transform. */
function drawFace(
  ctx: CanvasRenderingContext2D,
  face: ProjectedFace,
  step: number,
  book: BookPaint,
  scale: number,
  labels: LruCache<number, HTMLCanvasElement>,
  theme: BookTheme,
  paint: Paint,
) {
  if (face.side === 'front') {
    let spine = labels.get(step);
    if (!spine) {
      spine = renderSpine(book, theme, scale);
      labels.set(step, spine);
    }
    ctx.setTransform(...faceTransform(face, scale));
    // (The draw loop readies every spine in the window, so this rarely renders one.)
    ctx.drawImage(spine, 0, 0, face.width, face.height);
  } else if (face.side === 'top' || face.side === 'bottom') {
    // In the face's unit square, so the one cover gradient fits every book.
    ctx.setTransform(face.u.x * scale, face.u.y * scale, face.v.x * scale, face.v.y * scale, face.origin.x * scale, face.origin.y * scale);
    ctx.fillStyle = book.cover;
    ctx.fillRect(0, 0, 1, 1);
    if (face.side === 'top' && paint.coverShade) {
      ctx.fillStyle = paint.coverShade;
      ctx.fillRect(0, 0, 1, 1);
    }
  } else {
    // Page edges: the two short sides and the fore-edge at the back.
    ctx.setTransform(...faceTransform(face, scale));
    ctx.fillStyle = paint.pattern ?? theme.pages;
    ctx.fillRect(0, 0, face.width, face.height);
  }
}

interface Size {
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
  books: readonly { index: number; yaw: number }[],
  centre: number,
  shapes: readonly { width: number; depth: number }[],
  paints: readonly BookPaint[],
  theme: BookTheme,
) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, side, side);
  const mid = side / 2;
  const k = (side - 2 * theme.gap) / INSET_SPAN;
  const corners = (index: number, yaw: number) => {
    const { width: w, depth: d } = shapes[index];
    const c = Math.cos(yaw * RAD);
    const s = Math.sin(yaw * RAD);
    // Back-left, back-right, front-right, front-left: x across, z towards the reader (down here).
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, z]) => [mid + (x * c + z * s) * k, mid + (-x * s + z * c) * k] as const);
  };
  const outline = (pts: readonly (readonly [number, number])[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  const spineEdge = (pts: readonly (readonly [number, number])[], index: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[3][0], pts[3][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.strokeStyle = paints[index].band;
    ctx.lineWidth = theme.borderThick;
    ctx.stroke();
  };
  let centreYaw: number | null = null;
  ctx.lineWidth = theme.borderThin;
  for (const { index, yaw } of books) {
    if (index === centre) {
      centreYaw = yaw;
      continue;
    }
    const pts = corners(index, yaw);
    outline(pts);
    ctx.strokeStyle = theme.insetLine;
    ctx.lineWidth = theme.borderThin;
    ctx.stroke();
    spineEdge(pts, index);
  }
  if (centreYaw !== null) {
    const pts = corners(centre, centreYaw);
    outline(pts);
    ctx.fillStyle = paints[centre].cover;
    ctx.fill();
    ctx.strokeStyle = theme.insetHighlight;
    ctx.lineWidth = theme.borderThick;
    ctx.stroke();
    spineEdge(pts, centre);
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
  const paint = useRef<Paint>({ pattern: null, coverShade: null, scale: 0 });
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
    reduced: false,
    /** The tag's text, to skip writing it again. */
    tagKey: '',
  });
  // What the next frame draws: kept in a ref so scrolling never waits on React.
  const scene = useRef({ entries, shapes, centres, paints, twist, settle, describeCentre, onDraw });
  useLayoutEffect(() => {
    scene.current = { entries, shapes, centres, paints, twist, settle, describeCentre, onDraw };
  });

  const draw = useCallback(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const started = performance.now();
    const { width, height, scale } = size.current;
    const { entries, shapes, centres, paints, twist, describeCentre, onDraw } = scene.current;
    if (paint.current.scale !== scale) {
      labels.clear();
      // The cover's shade runs across a face's unit square, towards the spine.
      const coverShade = ctx.createLinearGradient(0, 0, 0, 1);
      coverShade.addColorStop(0.6, 'transparent');
      coverShade.addColorStop(1, theme.shade);
      paint.current = { pattern: pagesPattern(ctx, theme, scale), coverShade, scale };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const s = cam.current.shown;
    const view = { camera: FAN_CAMERA, originX: width / 2, originY: height / 2 };
    const win = fanWindow(centres, s, height / 2);
    const projected: ProjectedBook[] = [];
    const indexOf = new Map<number, number>();
    for (let i = win.start; i < win.end; i++) {
      const step = entries[i].step;
      projected.push(projectBook(fannedBook(i, step, shapes[i], centres, s, twist), view));
      indexOf.set(step, i);
      // Ready each spine as its book comes into the window, even facing away, so a turn of the
      // fan never has many spines to draw in one frame.
      if (!labels.get(step)) labels.set(step, renderSpine(paints[i], theme, scale));
    }
    for (const book of drawOrder(projected)) {
      const i = indexOf.get(book.step)!;
      for (const face of book.faces) drawFace(ctx, face, book.step, paints[i], scale, labels, theme, paint.current);
    }

    const centre = entries.length > 0 ? Math.round(clampPosition(s, entries.length)) : -1;
    const insetCtx = size.current.inset > 0 ? insetCanvas.current?.getContext('2d') : null;
    if (insetCtx && centre >= 0) {
      const near: { index: number; yaw: number }[] = [];
      const from = Math.max(win.start, centre - FAN_MIN_EACH_WAY);
      const to = Math.min(win.end, centre + FAN_MIN_EACH_WAY + 1);
      for (let i = from; i < to; i++) near.push({ index: i, yaw: relativeYaw(i, s, twist) });
      drawInset(insetCtx, size.current.inset, scale, near, centre, shapes, paints, theme);
    }
    if (tagBook.current && tagTurned.current && describeCentre && centre >= 0) {
      const entry = entries[centre];
      const degrees = Math.round(Math.abs(relativeYaw(centre, s, twist)));
      const key = `${entry.step}|${degrees}`;
      if (key !== cam.current.tagKey) {
        cam.current.tagKey = key;
        const text = describeCentre({ title: entry.title, avatar: entry.avatar, degrees });
        tagBook.current.textContent = text.book;
        tagTurned.current.textContent = text.turned;
      }
    }
    onDraw?.(performance.now() - started);
  }, [labels, theme]);

  /** Run the camera: one frame at a time (ease, draw) until it arrives, then stop. */
  const run = useCallback(() => {
    const c = cam.current;
    if (c.raf) return;
    const tick = (now: number) => {
      c.raf = 0;
      const dt = c.last > 0 ? now - c.last : 1000 / 60;
      c.last = now;
      const next = stepCamera(c.shown, c.target, dt, c.reduced);
      c.shown = next.shown;
      draw();
      if (!next.done) {
        c.raf = requestAnimationFrame(tick);
        return;
      }
      c.last = 0;
      if (c.settling) {
        c.settling = false;
        const el = scroller.current;
        const top = positionToScroll(c.shown, scene.current.entries.length);
        if (el && Math.abs(el.scrollTop - top) >= OWN_SCROLL_SLACK / 2) {
          c.expected = top;
          window.clearTimeout(c.expectedTimer);
          c.expectedTimer = window.setTimeout(() => (cam.current.expected = null), OWN_SCROLL_MS);
          el.scrollTop = top;
        }
      }
    };
    c.raf = requestAnimationFrame(tick);
  }, [draw]);

  /** Scrolling has stopped: come to rest on the nearest book. */
  const settleNow = useCallback(() => {
    const c = cam.current;
    const el = scroller.current;
    if (!el || !scene.current.settle) return;
    c.target = settleTarget(scrollToPosition(el.scrollTop, scene.current.entries.length), scene.current.entries.length);
    c.settling = true;
    run();
  }, [run]);

  // Size the canvases to the scroll area (backing at up to 2x) and the spacer to the pile, now
  // and on every resize, rotation or zoom, and draw straight away so the first frame isn't empty.
  useLayoutEffect(() => {
    const el = scroller.current;
    const c = canvas.current;
    if (!el || !c) return;
    let media: MediaQueryList | null = null;
    const fit = () => {
      const scale = canvasScale(window.devicePixelRatio);
      const width = el.clientWidth;
      const height = el.clientHeight;
      const insetEl = insetCanvas.current;
      const insetSide = insetEl ? insetEl.clientWidth : 0;
      size.current = { width, height, scale, inset: insetSide };
      c.width = backingSize(width, scale);
      c.height = backingSize(height, scale);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      if (insetEl && insetSide > 0) {
        insetEl.width = backingSize(insetSide, scale);
        insetEl.height = backingSize(insetSide, scale);
      }
      if (sizer.current) sizer.current.style.height = `${scrollHeight(scene.current.entries.length, height)}px`;
      draw();
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
    camState.target = camState.shown = scrollToPosition(el.scrollTop, scene.current.entries.length);
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
  }, [draw]);

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

  // A new twist, tag or inset: draw again where the camera is.
  useEffect(() => {
    if (!cam.current.raf) draw();
  }, [draw, twist, describeCentre, inset]);

  const handleScroll = () => {
    const c = cam.current;
    const el = scroller.current;
    if (!el) return;
    if (c.expected !== null && Math.abs(el.scrollTop - c.expected) < OWN_SCROLL_SLACK) {
      // The settle's own scroll: the camera is already there.
      c.expected = null;
      return;
    }
    c.expected = null;
    onScroll?.();
    c.target = scrollToPosition(el.scrollTop, scene.current.entries.length);
    c.settling = false;
    window.clearTimeout(c.settleTimer);
    if (scene.current.settle) c.settleTimer = window.setTimeout(settleNow, SETTLE_IDLE_MS);
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
