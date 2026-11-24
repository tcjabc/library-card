import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  SETTLE_IDLE_MS,
  clampPosition,
  positionToScroll,
  scrollHeight,
  scrollToPosition,
  settleTarget,
  startPosition,
  stepCamera,
  stepTarget,
} from './camera';
import { LruCache, backingSize, canvasScale, cssLength, fitWithEllipsis, graphemes } from './canvasHelpers';
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
  type StackOverrides,
} from './drawBudget';
import { READER_COLOURS, firstMarkerFrom, followPile, markerTop, type LabelPart, type StackItem, type StackMarkers } from './stackItems';
import { BOOK_DEPTHS, BOOK_THICKNESSES, BOOK_WIDTHS, bookShape, spineHue } from './stackModel';
import {
  FAN_CAMERA,
  TWIST_DEG,
  cameraYaw,
  faceTransform,
  eyeLineBooks,
  fannedBook,
  pileCentres,
  projectBook,
  relativeYaw,
  spineLevels,
  type ProjectedBook,
  type ProjectedFace,
  type View,
} from './stackProjection';
import './bookStack.css';
import './canvasStack.css';

/**
 * The Family Staircase's pile of books, drawn on one canvas (the Family Staircase screen, and the
 * developer tools' pretend piles). "Books that face the reader": the camera's position is a
 * continuous book index; the book there faces the reader square-on and its neighbours fan out by
 * the twist per book (stackProjection.ts), so the books near the middle of the screen are always
 * readable. The book at the eye line (the middle of the view) is the one being looked at.
 *
 * The camera's range is always the whole pile, [0, N - 1]: every pile scrolls, flicks, eases
 * and settles. Where it starts (camera.startPosition): a pile short enough to fit above the eye
 * line opens on its base book, with the pile rising above it; a taller pile opens on the newest
 * book. Either way, scrolling down all the way brings the base book to the eye line.
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
 *
 * Markers (stackItems.ts): a dashed line under the first book of each month with its label at
 * the right, and flags at the left for book numbers (#1, 10, 50, 100, every 100). Only those by
 * books in the draw window are drawn; their labels are drawn once and reused. A label that would
 * cover the book in the middle (the one being looked at) moves just above or below it instead
 * (markerTop in stackItems.ts).
 *
 * When the books change (a new read), the camera keeps the reader's book in front of them, or
 * moves up to the new newest book if they were looking at the newest (stackItems.followPile).
 * Resizing or turning the screen keeps the reader's book.
 * Arrow Up and Down step one book, with the same ease.
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
  /** Where the JS time went (ms): preparing spine labels, drawing the books (without label prep), the tag and inset, and the camera (ease, scroll handling, resolution) since the last frame. */
  labelMs: number;
  booksMs: number;
  overlayMs: number;
  cameraMs: number;
  /** Spine labels prepared this frame. */
  labels: number;
  /** Times the label cache was emptied and rebuilt this visit (a resolution step, or the benchmark). */
  rebuilds: number;
}

/** The benchmark's handle on the stack (developer tools): fixed set-ups, jumps and label control. */
export interface StackBench {
  /** Fix the set-up (null: back to the reader's own twist, settle and resolution, at the scroll position from before). */
  setOverrides(overrides: StackOverrides | null): void;
  /** Go to a scroll offset at once, no easing, and draw. */
  jumpTo(scrollTop: number): void;
  /** Empty the spine label cache. */
  clearLabels(): void;
  /** Prepare the spine labels of books [from, to) (indexes, oldest first). */
  prewarm(from: number, to: number): void;
  /** Draw one frame now. */
  drawNow(): void;
  scroller(): HTMLDivElement | null;
  count(): number;
  /** The canvas's backing size (px) and scale. */
  canvasSize(): { width: number; height: number; scale: number };
  /** Hear about every frame (null to stop). */
  listen(listener: ((stats: DrawStats) => void) | null): void;
}

export interface CanvasStackProps {
  /** Oldest first. */
  items: readonly StackItem[];
  /** Seeds each book's size (the household id). */
  seed: string;
  /** Month lines and book-number flags. */
  markers?: StackMarkers;
  /** The book in the middle changed (and on the first frame). */
  onCentre?: (item: StackItem, index: number) => void;
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
  /** Given the benchmark's handle while mounted, and null when unmounted (developer tools). */
  onBench?: (bench: StackBench | null) => void;
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
  /** The avatar's size (px), for the benchmark's plain avatars. */
  avatarSize: number;
  /** The inset's lines (px) and colours. */
  borderThin: number;
  borderThick: number;
  insetLine: string;
  insetHighlight: string;
  /** The page behind the pile: the canvas is opaque and fills itself with this. */
  background: string;
  /** The reader colours, --reader-1 first. */
  readers: string[];
  /** Markers: their labels' colours, text, padding and corners, the dashed line, and the gaps at the view's edges. */
  surface: string;
  text: string;
  border: string;
  milestone: string;
  onMilestone: string;
  markerFont: string;
  markerSize: number;
  yearFont: string;
  yearSize: number;
  markerEmojiFont: string;
  lineHeight: number;
  padX: number;
  padY: number;
  radius: number;
  dash: number;
  dashGap: number;
  gutter: number;
  /** Room left above a pile that fits over the eye line, for where it starts (px). */
  restGap: number;
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
    avatarSize: px('--text-md'),
    borderThin: px('--border-thin'),
    borderThick: px('--border-thick'),
    insetLine: v('--color-text-muted'),
    insetHighlight: v('--color-text'),
    background: v('--color-bg'),
    readers: Array.from({ length: READER_COLOURS }, (_, i) => v(`--reader-${i + 1}`)),
    surface: v('--color-surface'),
    text: v('--color-text'),
    border: v('--color-border'),
    milestone: v('--color-milestone'),
    onMilestone: v('--color-on-milestone'),
    markerFont: `${v('--weight-bold')} ${px('--text-sm')}px ${v('--font-body')}`,
    markerSize: px('--text-sm'),
    yearFont: `${v('--weight-bold')} ${px('--text-lg')}px ${v('--font-body')}`,
    yearSize: px('--text-lg'),
    markerEmojiFont: `${px('--text-sm')}px ${v('--font-emoji')}`,
    lineHeight: Number(v('--line-height')) || 1.45,
    padX: px('--space-2'),
    padY: px('--space-1'),
    radius: px('--radius-sm'),
    dash: px('--space-2'),
    dashGap: px('--space-1'),
    gutter: px('--space-3'),
    restGap: px('--space-5'),
  };
}

function hsl(hue: number, saturation: string, lightness: string): string {
  return `hsl(${hue}, ${saturation}, ${lightness})`;
}

interface BookPaint {
  /** The spine label's cache key: the book and everything drawn on its spine. */
  labelKey: string;
  title: string;
  avatar: string;
  spineHue: number;
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
function renderSpine(book: BookPaint, theme: BookTheme, scale: number, plainAvatar = false): HTMLCanvasElement {
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
  ctx.fillStyle = book.band;
  ctx.fillRect(0, 0, theme.bandWidth, t);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.onBook;
  let x = theme.bandWidth + theme.gap;
  if (plainAvatar) {
    // The benchmark's "plain avatars": a circle in the reader's colour with the title's initial, no emoji.
    const r = theme.avatarSize / 2;
    ctx.fillStyle = book.band;
    ctx.beginPath();
    ctx.arc(x + r, t / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.onBook;
    ctx.font = theme.titleFont;
    ctx.textAlign = 'center';
    ctx.fillText((graphemes(book.title)[0] ?? '').toUpperCase(), x + r, t / 2);
    ctx.textAlign = 'start';
    x += theme.avatarSize + theme.gap;
  } else {
    ctx.font = theme.avatarFont;
    ctx.fillText(book.avatar, x, t / 2);
    x += ctx.measureText(book.avatar).width + theme.gap;
  }
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

/** A marker's label, drawn once: its canvas and its size (px). */
interface Sprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

interface SpritePart {
  text: string;
  font: string;
  size: number;
}

/** A rounded rectangle's path (arcTo, for browsers without roundRect). */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A marker's label: the parts side by side on one baseline, on a rounded plate. */
function renderSprite(parts: readonly SpritePart[], fill: string, ink: string, edge: string | null, theme: BookTheme, scale: number): Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, width: 1, height: 1 };
  const widths = parts.map((part) => {
    ctx.font = part.font;
    return ctx.measureText(part.text).width;
  });
  const size = Math.max(...parts.map((part) => part.size));
  const width = Math.ceil(widths.reduce((a, b) => a + b, 0) + 2 * theme.padX);
  const height = Math.ceil(size * theme.lineHeight + 2 * theme.padY);
  canvas.width = backingSize(width, scale);
  canvas.height = backingSize(height, scale);
  ctx.scale(canvas.width / width, canvas.height / height);
  const inset = edge ? theme.borderThin / 2 : 0;
  roundedRect(ctx, inset, inset, width - 2 * inset, height - 2 * inset, theme.radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = theme.borderThin;
    ctx.stroke();
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  // One baseline for every part, so a larger year sits on the same line as the month.
  const baseline = height / 2 + size * 0.36;
  let x = theme.padX;
  parts.forEach((part, i) => {
    ctx.font = part.font;
    ctx.fillText(part.text, x, baseline);
    x += widths[i];
  });
  return { canvas, width, height };
}

function monthParts(parts: readonly LabelPart[], big: boolean, theme: BookTheme): SpritePart[] {
  return parts.map((part) =>
    part.year && big
      ? { text: part.text, font: theme.yearFont, size: theme.yearSize }
      : { text: part.text, font: theme.markerFont, size: theme.markerSize },
  );
}

/** A placed marker label this frame (px, the view's top left). */
interface PlacedSprite {
  sprite: Sprite;
  x: number;
  y: number;
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
  labels: LruCache<string, HTMLCanvasElement>;
  theme: BookTheme;
  paint: Paint;
  plainAvatars: boolean;
  /** Label preparation this frame: time (ms) and count. */
  prep: { ms: number; count: number };
}

/** A spine label from the cache, prepared (and timed) if it isn't there. */
function spineLabel(book: BookPaint, kit: FaceKit): HTMLCanvasElement {
  let spine = kit.labels.get(book.labelKey);
  if (!spine) {
    const started = performance.now();
    spine = renderSpine(book, kit.theme, kit.scale, kit.plainAvatars);
    kit.labels.set(book.labelKey, spine);
    kit.prep.ms += performance.now() - started;
    kit.prep.count += 1;
  }
  return spine;
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
function drawFace(ctx: CanvasRenderingContext2D, face: ProjectedFace, book: BookPaint, fromCamera: number, kit: FaceKit) {
  const { scale, theme, paint } = kit;
  if (face.side === 'front') {
    const spine = spineLabel(book, kit);
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

/** The bounding box of a book's faces on screen (px). */
function faceBox(faces: readonly ProjectedFace[]): { left: number; right: number; top: number; bottom: number } {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const f of faces) {
    for (const [x, y] of [
      [f.origin.x, f.origin.y],
      [f.origin.x + f.u.x, f.origin.y + f.u.y],
      [f.origin.x + f.v.x, f.origin.y + f.v.y],
      [f.origin.x + f.u.x + f.v.x, f.origin.y + f.u.y + f.v.y],
    ]) {
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, right, top, bottom };
}

/** The biggest book (px), for how many books fit above the eye line (stackProjection.eyeLineBooks). */
const BIGGEST_BOOK = { thickness: Math.max(...BOOK_THICKNESSES), width: Math.max(...BOOK_WIDTHS), depth: Math.max(...BOOK_DEPTHS) };
/** Marker labels kept ready to draw. */
const SPRITE_CACHE_SIZE = 64;

interface CameraState {
  expected: number | null;
  expectedTimer: number;
  scrollTop: number;
}

/** Move the scroll offset ourselves, so the scroll event it fires isn't taken for the reader's. */
function ownScroll(c: CameraState, el: HTMLDivElement, top: number) {
  if (Math.abs(el.scrollTop - top) >= OWN_SCROLL_SLACK / 2) {
    c.expected = top;
    window.clearTimeout(c.expectedTimer);
    c.expectedTimer = window.setTimeout(() => (c.expected = null), OWN_SCROLL_MS);
    el.scrollTop = top;
  }
  c.scrollTop = top;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function CanvasStack({
  items,
  seed,
  markers,
  onCentre,
  twist = TWIST_DEG,
  settle = true,
  inset = false,
  describeCentre,
  measureRaster = false,
  label,
  onScroller,
  onScroll,
  onDraw,
  onBench,
}: CanvasStackProps) {
  const count = items.length;
  const shapes = useMemo(() => items.map((item) => bookShape(seed, item.key)), [items, seed]);
  const centres = useMemo(() => pileCentres(shapes.map((s) => s.thickness)), [shapes]);
  const [theme] = useState(readTheme);
  // Oldest first, like `items`.
  const paints = useMemo<BookPaint[]>(
    () =>
      items.map((item, i) => {
        const hue = spineHue(item.isbn);
        const band = theme.readers[(item.readerColour - 1 + READER_COLOURS) % READER_COLOURS] || theme.readers[0];
        return {
          labelKey: `${item.key}\u0000${item.title}\u0000${item.avatar}\u0000${item.readerColour}`,
          title: item.title,
          avatar: item.avatar,
          spineHue: hue,
          width: shapes[i].width,
          thickness: shapes[i].thickness,
          cover: hsl(hue, theme.spineSaturation, theme.coverLightness),
          band,
        };
      }),
    [items, shapes, theme],
  );
  const labels = useMemo(() => new LruCache<string, HTMLCanvasElement>(LABEL_CACHE_SIZE), []);
  const sprites = useMemo(() => new LruCache<string, Sprite>(SPRITE_CACHE_SIZE), []);

  const scroller = useRef<HTMLDivElement | null>(null);
  const sizer = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const insetCanvas = useRef<HTMLCanvasElement | null>(null);
  const tagEl = useRef<HTMLParagraphElement | null>(null);
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
    /** The book in the middle at the last frame (for onCentre), -1 before the first. */
    centre: -1,
    /** Books that fit above the eye line in this view (where a pile starts: camera.startPosition). */
    k: 0,
    /** Camera work (ease, scroll handling, resolution) since the last frame (ms). */
    cameraMs: 0,
    /** Label cache rebuilds this visit. */
    rebuilds: 0,
    /** The benchmark's fixed set-up, and what to go back to afterwards. */
    overrides: null as StackOverrides | null,
    saved: null as { scale: number; scaleCap: number; scrollTop: number } | null,
    listener: null as ((stats: DrawStats) => void) | null,
  });
  // What the next frame draws: kept in a ref so scrolling never waits on React.
  const scene = useRef({ items, shapes, centres, paints, markers, onCentre, twist, settle, describeCentre, measureRaster, onDraw });
  useLayoutEffect(() => {
    scene.current = { items, shapes, centres, paints, markers, onCentre, twist, settle, describeCentre, measureRaster, onDraw };
  });
  /** This frame's marker labels and month lines (reused every frame). */
  const placed = useRef({ sprites: [] as PlacedSprite[], lines: [] as number[] });

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
      const { items, shapes, centres, paints, markers, onCentre, describeCentre, measureRaster, onDraw } = scene.current;
      const o = c.overrides;
      const twist = o ? o.twist : scene.current.twist;
      const overlays = o ? o.overlays : true;
      if (paint.current.scale !== scale) {
        if (paint.current.scale !== 0) c.rebuilds += 1;
        labels.clear();
        sprites.clear();
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
      const total = items.length;
      let faces = 0;
      let from = 0;
      let to = 0;
      const prep = { ms: 0, count: 0 };
      const booksStart = performance.now();
      const centre = total > 0 ? Math.round(clampPosition(s, total)) : -1;
      if (centre >= 0) {
        const originY = height / 2;
        const view: View = { camera: FAN_CAMERA, originX: width / 2, originY };
        const books = scratch.current;
        books.fill(null);
        const base = centre - FAN_CAP;
        const projectAt = (i: number): ProjectedBook => {
          let book = books[i - base];
          if (!book) {
            book = projectBook(fannedBook(i, items[i].step, shapes[i], centres, s, twist), view);
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
        const kit: FaceKit = { scale, labels, theme, paint: paint.current, plainAvatars: o?.plainAvatars ?? false, prep };
        const marks = placed.current;
        marks.sprites.length = 0;
        marks.lines.length = 0;
        if (markers) {
          // Only markers by books in the window. One that would cover the middle book moves above or below it.
          const middle = faceBox(projectAt(centre).faces);
          const sprite = (key: string, make: () => Sprite) => {
            let got = sprites.get(key);
            if (!got) {
              const started = performance.now();
              got = make();
              sprites.set(key, got);
              prep.ms += performance.now() - started;
              prep.count += 1;
            }
            return got;
          };
          const put = (sp: Sprite, x: number, y: number) => {
            const top = markerTop({ x, y, width: sp.width, height: sp.height }, middle, height, theme.padY);
            marks.sprites.push({ sprite: sp, x: Math.round(x * scale) / scale, y: Math.round(top * scale) / scale });
          };
          for (let k = firstMarkerFrom(markers.months, from); k < markers.months.length && markers.months[k].index < to; k++) {
            const m = markers.months[k];
            const y = spineLevels(m.index, shapes[m.index], centres, s, twist, originY).bottom;
            if (y < 0 || y > height) continue;
            marks.lines.push(y);
            const key = `m\u0000${m.big ? 1 : 0}\u0000${m.parts.map((p) => p.text).join('')}`;
            const sp = sprite(key, () => renderSprite(monthParts(m.parts, m.big, theme), theme.surface, theme.text, theme.border, theme, scale));
            put(sp, width - theme.gutter - sp.width, y - theme.padY - sp.height);
          }
          for (let k = firstMarkerFrom(markers.flags, from); k < markers.flags.length && markers.flags[k].index < to; k++) {
            const f = markers.flags[k];
            const y = spineLevels(f.index, shapes[f.index], centres, s, twist, originY).middle;
            const sp = sprite(`f\u0000${f.text}`, () =>
              renderSprite(
                [
                  { text: '🚩 ', font: theme.markerEmojiFont, size: theme.markerSize },
                  { text: f.text, font: theme.markerFont, size: theme.markerSize },
                ],
                theme.milestone,
                theme.onMilestone,
                null,
                theme,
                scale,
              ),
            );
            if (y + sp.height / 2 < 0 || y - sp.height / 2 > height) continue;
            put(sp, theme.gutter, y - sp.height / 2);
          }
        }
        const drawSprites = (list: readonly PlacedSprite[]) => {
          if (list.length === 0) return;
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          for (const { sprite: sp, x, y } of list) {
            ctx.drawImage(sp.canvas, x, y, sp.width, sp.height);
            ops += 1;
          }
        };
        // Bottom of the pile first: index order is painter's order (stackProjection's drawOrder).
        for (let i = from; i < to; i++) {
          const book = projectAt(i);
          // Ready each spine as its book comes into the window, even facing away, so a turn of
          // the fan never has many spines to draw in one frame.
          spineLabel(paints[i], kit);
          for (const face of book.faces) drawFace(ctx, face, paints[i], i - s, kit);
          faces += book.faces.length;
        }
        if (marks.lines.length > 0) {
          // Month lines across the pile, in one dashed stroke.
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.beginPath();
          for (const y of marks.lines) {
            const at = (Math.round(y * scale) + 0.5) / scale;
            ctx.moveTo(theme.gutter, at);
            ctx.lineTo(width - theme.gutter, at);
          }
          ctx.setLineDash([theme.dash, theme.dashGap]);
          ctx.strokeStyle = theme.insetLine;
          ctx.lineWidth = theme.borderThin;
          ctx.stroke();
          ctx.setLineDash([]);
          ops += 1;
        }
        drawSprites(marks.sprites);
        if (centre !== c.centre) {
          c.centre = centre;
          onCentre?.(items[centre], centre);
        }
      }

      const booksMs = performance.now() - booksStart - prep.ms;
      let raster: number | undefined;
      c.frame += 1;
      if (measureRaster && !settled && c.frame % RASTER_EVERY === 0) {
        const flushStart = performance.now();
        ctx.getImageData(0, 0, 1, 1);
        raster = performance.now() - flushStart;
      }

      const overlayStart = performance.now();
      if (centre >= 0 && overlays) {
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
          const item = items[centre];
          const degrees = Math.round(Math.abs(relativeYaw(centre, s, twist)));
          if (tagChanged(c.tag, item.step, degrees)) {
            c.tag = { step: item.step, degrees };
            const text = describeCentre({ title: item.title, avatar: item.avatar, degrees });
            tagBook.current.textContent = text.book;
            tagTurned.current.textContent = text.turned;
          }
        }
      }
      const end = performance.now();
      const stats: DrawStats = {
        ms: end - started,
        faces,
        ops,
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        scale,
        raster,
        labelMs: prep.ms,
        booksMs,
        overlayMs: end - overlayStart,
        cameraMs: c.cameraMs,
        labels: prep.count,
        rebuilds: c.rebuilds,
      };
      c.cameraMs = 0;
      onDraw?.(stats);
      c.listener?.(stats);
    },
    [labels, sprites, theme],
  );

  /** Run the camera: one frame at a time (ease, draw) until it arrives, then stop. */
  const run = useCallback(() => {
    const c = cam.current;
    if (c.raf) return;
    const tick = (now: number) => {
      const cameraStart = performance.now();
      c.raf = 0;
      const moving = c.last > 0;
      const dt = moving ? now - c.last : 1000 / 60;
      c.last = now;
      const next = stepCamera(c.shown, c.target, dt, c.reduced);
      c.shown = next.shown;
      // Slow frames for a second of motion: step the resolution down (never back up). Not while
      // "Measure raster" is on: its read-backs slow the canvas themselves.
      if (moving && !scene.current.measureRaster && !c.overrides) {
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
      c.cameraMs += performance.now() - cameraStart;
      draw(next.done);
      if (!next.done) {
        c.raf = requestAnimationFrame(tick);
        return;
      }
      c.last = 0;
      if (c.settling) {
        c.settling = false;
        const el = scroller.current;
        const top = positionToScroll(c.shown, scene.current.items.length);
        if (el && Math.abs(c.scrollTop - top) >= OWN_SCROLL_SLACK / 2) ownScroll(c, el, top);
      }
    };
    c.raf = requestAnimationFrame(tick);
  }, [applyScale, draw]);

  /** Scrolling has stopped: come to rest on the nearest book. */
  const settleNow = useCallback(() => {
    const c = cam.current;
    if (!(c.overrides ? c.overrides.settle : scene.current.settle)) return;
    const total = scene.current.items.length;
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
    const fit = (first = false) => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const insetEl = insetCanvas.current;
      size.current = { width, height, scale: size.current.scale, inset: insetEl ? insetEl.clientWidth : 0 };
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      applyScale(Math.min(canvasScale(window.devicePixelRatio), cam.current.scaleCap));
      // K for this view's height. The scroll range is the whole pile whatever the height, and a
      // book's scroll offset doesn't depend on it, so a resize or a turn keeps the reader's book.
      const cs = cam.current;
      const count = scene.current.items.length;
      cs.k = eyeLineBooks(height, BIGGEST_BOOK, theme.restGap);
      if (sizer.current) sizer.current.style.height = `${scrollHeight(count, height)}px`;
      if (first) {
        // Opening: the base book if the pile fits above the eye line, else the newest.
        cs.target = cs.shown = startPosition(count, cs.k);
        ownScroll(cs, el, positionToScroll(cs.target, count));
      }
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
    fit(true);
    watchScale();
    const resize = new ResizeObserver(() => fit());
    resize.observe(el);
    return () => {
      resize.disconnect();
      media?.removeEventListener('change', onScale);
      cancelAnimationFrame(camState.raf);
      camState.raf = 0;
      window.clearTimeout(camState.settleTimer);
      window.clearTimeout(camState.expectedTimer);
    };
  }, [applyScale, draw, theme]);

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
    const started = performance.now();
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
    c.target = scrollToPosition(c.scrollTop, scene.current.items.length);
    c.settling = false;
    window.clearTimeout(c.settleTimer);
    if (c.overrides ? c.overrides.settle : scene.current.settle) c.settleTimer = window.setTimeout(settleNow, SETTLE_IDLE_MS);
    // Drawing happens in the frame loop only: one draw per frame however many scroll events arrive.
    run();
    c.cameraMs += performance.now() - started;
    // (After the timing: the measurement panel's own bookkeeping isn't the stack's cost.)
    onScroll?.();
  };

  /** Go to a scroll offset at once (no easing), as if the camera had always been there, and draw. */
  const jumpTo = useCallback(
    (top: number) => {
      const c = cam.current;
      const el = scroller.current;
      if (!el) return;
      cancelAnimationFrame(c.raf);
      c.raf = 0;
      c.last = 0;
      c.settling = false;
      window.clearTimeout(c.settleTimer);
      ownScroll(c, el, top);
      c.target = c.shown = scrollToPosition(top, scene.current.items.length);
      draw(true);
    },
    [draw],
  );

  // New books (or fewer): keep the reader's book in front of them, stay on the base book, or
  // follow the newest book up if that's where they were (stackItems.followPile), without a jump.
  const keys = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    const next = items.map((item) => item.key);
    const prev = keys.current;
    keys.current = next;
    const c = cam.current;
    if (!prev) return;
    // Titles or colours may have changed even when the books haven't: tell onCentre again.
    c.centre = -1;
    c.tag = null;
    const el = scroller.current;
    const same = prev.length === next.length && prev.every((key, i) => key === next[i]);
    if (same || !el) {
      if (!c.raf) draw(true);
      return;
    }
    const moved = followPile(prev, next, c.target, c.shown);
    const books = next.length;
    if (sizer.current) sizer.current.style.height = `${scrollHeight(books, size.current.height)}px`;
    window.clearTimeout(c.settleTimer);
    c.settling = false;
    c.target = moved.target;
    c.shown = moved.shown;
    ownScroll(c, el, positionToScroll(moved.target, books));
    if (c.raf) return;
    if (moved.target === moved.shown) draw(true);
    else run();
  }, [items, draw, run]);

  /** Arrow Up and Down: one book up (newer) or down (older), with the ease. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const by = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    const el = scroller.current;
    const c = cam.current;
    const total = scene.current.items.length;
    if (!by || !el || total === 0) return;
    event.preventDefault();
    window.clearTimeout(c.settleTimer);
    c.settling = false;
    c.target = stepTarget(c.target, by, total);
    ownScroll(c, el, positionToScroll(c.target, total));
    run();
  };

  // The benchmark's handle (developer tools): nothing here runs unless the benchmark calls it.
  useEffect(() => {
    if (!onBench) return;
    const c = cam.current;
    const clearLabels = () => {
      labels.clear();
      c.rebuilds += 1;
    };
    const hideOverlays = (hidden: boolean) => {
      if (tagEl.current) tagEl.current.hidden = hidden;
      if (insetCanvas.current) insetCanvas.current.hidden = hidden;
    };
    const handle: StackBench = {
      setOverrides(next) {
        if (next && !c.overrides) c.saved = { scale: size.current.scale, scaleCap: c.scaleCap, scrollTop: c.scrollTop };
        // A bigger label cache while benchmarking, the normal one afterwards.
        labels.resize(next ? Math.max(LABEL_CACHE_SIZE, next.labelCache) : LABEL_CACHE_SIZE);
        const plainChanged = (c.overrides?.plainAvatars ?? false) !== (next?.plainAvatars ?? false);
        c.overrides = next;
        c.motionFrames = 0;
        c.motionMs = 0;
        c.tag = null;
        c.inset = null;
        if (plainChanged) clearLabels();
        hideOverlays(next ? !next.overlays : false);
        if (next) {
          if (size.current.scale !== next.scale) applyScale(next.scale);
          draw(true);
        } else if (c.saved) {
          const saved = c.saved;
          c.saved = null;
          c.scaleCap = saved.scaleCap;
          if (size.current.scale !== saved.scale) applyScale(saved.scale);
          jumpTo(saved.scrollTop);
        }
      },
      jumpTo,
      clearLabels,
      prewarm(from, to) {
        const { items, paints } = scene.current;
        const kit: FaceKit = {
          scale: size.current.scale,
          labels,
          theme,
          paint: paint.current,
          plainAvatars: c.overrides?.plainAvatars ?? false,
          prep: { ms: 0, count: 0 },
        };
        for (let i = Math.max(0, from); i < Math.min(items.length, to); i++) spineLabel(paints[i], kit);
      },
      drawNow: () => draw(true),
      scroller: () => scroller.current,
      count: () => scene.current.items.length,
      canvasSize: () => ({ width: canvas.current?.width ?? 0, height: canvas.current?.height ?? 0, scale: size.current.scale }),
      listen(listener) {
        c.listener = listener;
      },
    };
    onBench(handle);
    return () => {
      onBench(null);
      c.listener = null;
    };
  }, [onBench, applyScale, draw, jumpTo, labels, theme]);

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
        onKeyDown={handleKeyDown}
      >
        <div ref={sizer} className="book-stack__sizer" style={{ height: scrollHeight(count, 0) }} />
      </div>
      <canvas ref={canvas} className="canvas-stack__canvas" aria-hidden="true" />
      {describeCentre && (
        <p ref={tagEl} className="canvas-stack__tag">
          <span ref={tagBook} className="canvas-stack__tag-book" />
          <span ref={tagTurned} className="canvas-stack__tag-turned" />
        </p>
      )}
      {inset && <canvas ref={insetCanvas} className="canvas-stack__inset" aria-hidden="true" />}
    </div>
  );
}

export default memo(CanvasStack);
