import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LruCache, backingSize, canvasScale, cssLength, fitWithEllipsis } from './canvasHelpers';
import {
  STACK_BUFFER,
  STACK_PAD_BOTTOM,
  STACK_PAD_TOP,
  TILT_SCALE,
  bookShape,
  stackLayout,
  type StackEntry,
} from './stackModel';
import {
  STACK_CAMERA,
  drawOrder,
  faceTransform,
  placedBooks,
  projectBook,
  projectedWindow,
  yawForScroll,
  type ProjectedBook,
  type ProjectedFace,
} from './stackProjection';
import './bookStack.css';
import './canvasStack.css';

/**
 * The book pile drawn on one canvas (stage 1 prototype, developer tools only), to compare with
 * the CSS 3D version: the same seeded books, layout and camera (stackProjection.ts), but one
 * layer for the compositor instead of hundreds of transformed faces.
 *
 * A native scroll area with a sized spacer keeps the browser's own (inertia) scrolling; the
 * canvas sits over it, out of the way of touches, and is redrawn once per frame while it scrolls
 * (requestAnimationFrame, no React state). Only the books that can be on screen are drawn, and
 * nothing runs while the pile is still: nothing moves by itself, whatever prefers-reduced-motion
 * says. Each spine's label is drawn once to a small canvas and reused.
 */

export interface CanvasStackProps {
  /** Oldest first. */
  entries: readonly StackEntry[];
  /** Seeds each book's size and wobble (the household id, later). */
  seed: string;
  /** Turn the camera as the pile scrolls (to measure the worst case: every book moves every frame). */
  rotate?: boolean;
  /** The scroll area's name. */
  label: string;
  /** The scroll area, for measuring. */
  onScroller?: (el: HTMLDivElement | null) => void;
  onScroll?: () => void;
  /** How long each frame's drawing took (ms). */
  onDraw?: (ms: number) => void;
}

/** Books drawn above and below the ones that can be on screen. */
const BUFFER = STACK_BUFFER * 2;
/** Spine labels kept ready to draw. */
const LABEL_CACHE_SIZE = 100;

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
}

function CanvasStack({ entries, seed, rotate = false, label, onScroller, onScroll, onDraw }: CanvasStackProps) {
  const shapes = useMemo(() => entries.map((e) => bookShape(seed, e.step)), [entries, seed]);
  const layout = useMemo(() => stackLayout(shapes.map((s) => s.thickness)), [shapes]);
  const books = useMemo(() => placedBooks(entries, shapes, layout), [entries, shapes, layout]);
  const [theme] = useState(readTheme);
  // Newest first, like `books`.
  const paints = useMemo<BookPaint[]>(
    () =>
      books.map((book, row) => {
        const entry = entries[entries.length - 1 - row];
        return {
          title: entry.title,
          avatar: entry.avatar,
          spineHue: entry.spineHue,
          readerHue: entry.readerHue,
          width: book.shape.width,
          thickness: book.shape.thickness,
          cover: hsl(entry.spineHue, theme.spineSaturation, theme.coverLightness),
        };
      }),
    [books, entries, theme],
  );
  const labels = useMemo(() => new LruCache<number, HTMLCanvasElement>(LABEL_CACHE_SIZE), []);

  const scroller = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const size = useRef<Size>({ width: 0, height: 0, scale: 1 });
  const paint = useRef<Paint>({ pattern: null, coverShade: null, scale: 0 });
  // What the next frame draws: kept in a ref so scrolling never waits on React.
  const scene = useRef({ books, paints, layout, rotate, onDraw });
  useLayoutEffect(() => {
    scene.current = { books, paints, layout, rotate, onDraw };
  });

  const draw = useCallback(() => {
    frame.current = 0;
    const el = scroller.current;
    const ctx = canvas.current?.getContext('2d');
    if (!el || !ctx) return;
    const started = performance.now();
    const { width, height, scale } = size.current;
    const { books, paints, layout, rotate, onDraw } = scene.current;
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

    const scrollTop = el.scrollTop;
    const camera = rotate ? { pitch: STACK_CAMERA.pitch, yaw: yawForScroll(scrollTop) } : STACK_CAMERA;
    const view = { camera, originX: width / 2, originY: STACK_PAD_TOP - scrollTop };
    const win = projectedWindow(layout, scrollTop - STACK_PAD_TOP, height, BUFFER, camera.pitch);
    const projected: ProjectedBook[] = [];
    const rows = new Map<number, number>();
    for (let row = win.start; row < win.end; row++) {
      const step = books[row].step;
      projected.push(projectBook(books[row], view));
      rows.set(step, row);
      // Ready each spine as its book comes into the window, even facing away: a turning
      // camera then never has dozens of spines to draw in one frame.
      if (!labels.get(step)) labels.set(step, renderSpine(paints[row], theme, scale));
    }

    for (const book of drawOrder(projected)) {
      const row = rows.get(book.step)!;
      for (const face of book.faces) drawFace(ctx, face, book.step, paints[row], scale, labels, theme, paint.current);
    }
    onDraw?.(performance.now() - started);
  }, [labels, theme]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Size the canvas to the scroll area (its backing at up to 2x), now and on every resize,
  // rotation or zoom, and draw straight away so the first frame isn't empty.
  useLayoutEffect(() => {
    const el = scroller.current;
    const c = canvas.current;
    if (!el || !c) return;
    let media: MediaQueryList | null = null;
    const fit = () => {
      const scale = canvasScale(window.devicePixelRatio);
      const width = el.clientWidth;
      const height = el.clientHeight;
      size.current = { width, height, scale };
      c.width = backingSize(width, scale);
      c.height = backingSize(height, scale);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      cancelAnimationFrame(frame.current);
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
    fit();
    watchScale();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    return () => {
      resize.disconnect();
      media?.removeEventListener('change', onScale);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [draw]);

  // A new pile or the rotate switch: draw again (the next frame is soon enough).
  useEffect(schedule, [schedule, books, paints, rotate]);

  const handleScroll = () => {
    onScroll?.();
    schedule();
  };

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      onScroller?.(el);
    },
    [onScroller],
  );

  const spacer = STACK_PAD_TOP + STACK_PAD_BOTTOM + layout.height * TILT_SCALE;

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
        <div className="book-stack__sizer" style={{ height: spacer }} />
      </div>
      <canvas ref={canvas} className="canvas-stack__canvas" aria-hidden="true" />
    </div>
  );
}

export default memo(CanvasStack);
