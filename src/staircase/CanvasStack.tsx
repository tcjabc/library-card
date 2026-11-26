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
import { LruCache, backingSize, canvasScale, cssDuration, cssLength, fitWithEllipsis, graphemes } from './canvasHelpers';
import { CoverArt, type CoverFade, type CoverWish } from './coverArt';
import { coverCrop } from './coverColour';
import { provideCoverReport, type CoverReport } from './coverDiagnostics';
import { coverJobs, showsPicture, travelOf, type Travel } from './coverPlan';
import { bookLift, liftAbove, lineLift } from './eyeGap';
import {
  BIGGEST_SHAPED_BOOK,
  STANDARD_DEPTH,
  STANDARD_WIDTH,
  THICKNESS_BUCKET,
  WIDTH_BUCKET,
  coverFootprint,
  easeFootprint,
  pileShape,
  sizeBucket,
  spineTextScale,
} from './bookShapes';
import {
  addFallers,
  dropActive,
  dropCamera,
  dropLift,
  dropSpin,
  highlightAlpha,
  HIGHLIGHT_MS,
  landedCount,
  markerAlpha,
  squashScale,
  startDrop,
  stepDrop,
  waiting,
  type DropWorld,
} from './dropMotion';
import { MAX_DROP } from './stackSeen';
import {
  SCENE_DROP,
  SHADOW_FORWARD,
  SHADOW_OUTER_ALPHA,
  SHADOW_SPREAD,
  SkyGradients,
  altitudeAt,
  cssColour,
  groundContactY,
  groundInView,
  groundShadowFootprint,
  groundSize,
  horizonY,
  lineStyle,
  mix,
  parseColour,
  shadowInView,
  shadowStrength,
  skyColour,
  skyT,
  viewSky,
  type Rgba,
} from './scenery';
import { flushForTiming, markTainted } from './pixelGuard';
import {
  CLOUD_ASPECT,
  CLOUD_BAR,
  CLOUD_BASE,
  CLOUD_SHADE_RISE,
  CLOUD_SHAPES,
  CLOUD_WIDTH,
  cloudLayers,
  placeClouds,
  type CloudLayer,
  type PlacedCloud,
} from './clouds';
import {
  FAN_CAP,
  budgetDue,
  budgetFrameMs,
  decorInEffect,
  faceSpan,
  faceThickness,
  PAGE_RANGE,
  easePageRange,
  insetDue,
  nextBudget,
  pageLineAlpha,
  tagChanged,
  visibleRange,
  type Decor,
  type DecorWhy,
  type InsetState,
  type PageLines,
  type StackOverrides,
} from './drawBudget';
import { READER_COLOURS, atNewest, firstMarkerFrom, followPile, markerTop, type LabelPart, type StackItem, type StackMarkers } from './stackItems';
import { BIGGEST_BOOK, BOOK_DEPTHS, BOOK_WIDTHS, spineHue, type BookShape } from './stackModel';
import {
  FAN_CAMERA,
  TWIST_DEG,
  cameraYaw,
  faceTransform,
  eyeLineBooks,
  eyeLineReach,
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
 * to a small canvas and reused. Every drawn book's page edges have their lines (fading out past
 * the range, and in as a side turns towards you, so none pop on or off); edge-on ones are a flat
 * fill. The canvas is
 * opaque: each frame starts with the scenery (scenery.ts: the sky as one gradient by altitude,
 * then the meadow, its horizon and the base book's shadow), or the page's plain background with
 * the sky off. If frames are slow it lowers the decor, then cuts the page lines back to the books
 * near the eye line, then steps its resolution down, for the rest of the visit. The tag
 * and the top-down inset only redraw when they change.
 *
 * Scenery (`sky`, `ground`, scenery.ts): the sky's colour goes by altitude (absolute, so a pile's
 * sky never changes as it grows); the ground is anchored to the world, moving 1:1 with the base
 * book (its gap lift included) and scrolling away as the camera climbs. Colours come from the
 * --stack-* tokens, read again when the colour scheme changes while the pile is open.
 *
 * Clouds (`clouds`, `foreground`, `decor`, clouds.ts): backdrop clouds painted after the sky and
 * before the ground (which hides any behind the horizon), moving 0.25–0.35 of the scroll; then,
 * with Full decor, a few faint wisps after the ground, moving 1.2–1.4× of it; all before the books,
 * so never in front of one. With reduced motion, a denser layer moving 1:1 instead of both. Seeded
 * by the household, layer and altitude cell, so they never move as the pile grows; changed only
 * when a frame is drawn anyway; faded where they cross the eye-line band. Their sprites (one
 * atlas) are drawn once per resolution, as the labels are. The decor drawn is the least of the device's setting, this visit's cap and (with
 * reduced motion) reduced: slow frames lower the decor first (full → reduced → none), and only
 * then the resolution.
 *
 * Markers (stackItems.ts): a dashed line under the first book of each month with its label at
 * the right, and flags at the left for book numbers (#1, 10, 50, 100, every 100). Only those by
 * books in the draw window are drawn; their labels are drawn once and reused. A label that would
 * cover the book in the middle (the one being looked at) moves just above or below it instead
 * (markerTop in stackItems.ts).
 *
 * Covers (`covers`, coverArt.ts, coverPlan.ts): a book with a cover takes its spine's colour from
 * it, and every drawn book whose top face is big enough on screen draws the cover's picture there,
 * as on a real book lying front up with its spine towards the reader. Both are loaded ahead of the
 * camera and measured in idle time, never while drawing; until then a book has its own colour,
 * and one arriving for a book on screen fades in (instantly with reduced motion).
 *
 * Cover shapes (`coverShapes`, bookShapes.ts): each book's footprint follows its cover's shape
 * (tall, square, wide) at a fixed area, easing in when the shape arrives; its thickness is a
 * little different per book from a hash of its ISBN, never from the cover, so the pile's height
 * never changes when a cover arrives. Off: the seeded sizes from before.
 *
 * The gap (`gap`, eyeGap.ts): the books above the eye-line book lift away and the books below it
 * drop a little, by their distance from the camera, so the gap travels with the camera and the
 * book being looked at shows its top face and spine. Its markers move with their books; K leaves
 * room for the lift.
 *
 * New books falling (`drop`, dropMotion.ts): the newest books fall onto the pile one after
 * another, the pile springs, dust puffs; the camera starts where it would for the pile without
 * them and ends at the normal opening place, following the landed books up a tall pile. With
 * `liveDrops`, books arriving while the camera follows the newest fall the same way. Drawing runs
 * only while something moves. Highlights (reduced motion, too many books) are a calm outline pulse.
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
  /** With covers on: the cover pictures kept and their memory (bytes). */
  covers?: { pictures: number; bytes: number };
  /** The sky's t (scenery.skyT) at the top and the bottom of its gradient this frame, or null with no sky drawn. */
  sky: { top: number; bottom: number } | null;
  /** Whether any ground was drawn this frame. */
  ground: boolean;
  /** Backdrop clouds drawn this frame (the still layer's with reduced motion), and foreground wisps. */
  clouds: number;
  cloudsFg: number;
  /** The page lines: how far they may reach this visit, and the range drawn this frame (books from the camera). */
  pages: { level: PageLines; range: number };
  /** The decor: the device's setting, this visit's cap (slow frames), what's drawn, and why. */
  decor: { setting: Decor; cap: Decor; drawn: Decor; why: DecorWhy };
}

/** New books to greet: `count` of the newest fall, or are highlighted. */
export interface StackDrop {
  id: number;
  count: number;
  kind: 'fall' | 'highlight';
}

/** A drop running: the world, where its books start (the pile before them), and whether the camera follows. */
interface DropRun {
  world: DropWorld;
  base: number;
  follow: boolean;
  last: number;
}

/** A highlight running: books [start, end), since `from` (performance.now()). */
interface HighlightRun {
  start: number;
  end: number;
  from: number;
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
  /** Draw nothing while true (something covers the pile); catch up when it's false again. */
  paused?: boolean;
  /** The books' real covers (each item's `cover`): their colour on the spines, their picture on the top faces up close. */
  covers?: boolean;
  /** Developer tools' Cover diagnostics describe this pile (the Family Staircase's): coverDiagnostics.ts. */
  reportCovers?: boolean;
  /** Footprints from the covers' shapes and thicknesses from the books (bookShapes.ts); off: the seeded sizes. */
  coverShapes?: boolean;
  /** The gap around the eye-line book (eyeGap.ts): the books above lift away, the books below drop a little. */
  gap?: boolean;
  /** The sky behind the pile, by altitude (scenery.ts); off: the page's plain background. */
  sky?: boolean;
  /** The meadow the pile stands on, its horizon and the base book's shadow (scenery.ts). */
  ground?: boolean;
  /** Clouds in the sky (clouds.ts; with the sky only). */
  clouds?: boolean;
  /** The foreground wisps (with Full decor; never with reduced motion). */
  foreground?: boolean;
  /** The decor level (clouds) this device chose; what's drawn may be less (slow frames, reduced motion). */
  decor?: Decor;
  /** Developer tools' "Pretend slow frames": the budget hears every moving frame as slow (drawBudget.budgetFrameMs). */
  pretendSlow?: boolean;
  /** New books to greet (dropMotion.ts): the newest `count` fall onto the pile, or show with a brief outline. A new `id` starts one. */
  drop?: StackDrop | null;
  /** Books arriving at the top while the camera follows the newest fall too (highlighted with reduced motion). */
  liveDrops?: boolean;
  /** A falling book landed (its first landing): for the thud and the vibration. */
  onLanding?: (landing: { mass: number; impulse: number }) => void;
  /** A drop or highlight finished (or was cut short by the pile changing). */
  onDropEnd?: () => void;
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
/** A frame without clouds (shared, never changed). */
const NO_CLOUDS: PlacedCloud[] = [];
const NO_LAYERS: CloudLayer[] = [];

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
  /** The spine's title and avatar sizes (px), weight and families, for text scaled to a book's thickness. */
  titleSize: number;
  titleWeight: string;
  bodyFamily: string;
  emojiFamily: string;
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
  /** A cover arriving for a book on screen fades in over this long (ms). */
  crossfadeMs: number;
  /** The scenery's colours (--stack-*), parsed; a missing or unreadable one leaves its part out. */
  scenery: SceneryTheme;
}

interface SceneryTheme {
  /** Low, high, upper and space, or null (no sky). */
  sky: Rgba[] | null;
  horizon: Rgba | null;
  /** The meadow near the pile and at the horizon, or null (no ground). */
  ground: Rgba | null;
  groundFar: Rgba | null;
  shadow: string;
  /** Month lines over the scenery: the two inks, and the page's background (behind with the sky off). */
  lineOnLight: Rgba | null;
  lineOnDark: Rgba | null;
  background: Rgba | null;
  /** The clouds' lit colour and their shade, or null (no clouds). */
  cloud: Rgba | null;
  cloudShade: Rgba | null;
}

function readScenery(v: (name: string) => string): SceneryTheme {
  const colour = (name: string) => parseColour(v(name));
  const sky = ['--stack-sky-low', '--stack-sky-high', '--stack-sky-upper', '--stack-sky-space'].map(colour);
  const ground = colour('--stack-ground');
  const groundFar = colour('--stack-ground-far');
  return {
    sky: sky.every((c) => c !== null) ? (sky as Rgba[]) : null,
    horizon: colour('--stack-horizon'),
    ground: ground && groundFar ? ground : null,
    groundFar,
    shadow: v('--stack-ground-shadow'),
    lineOnLight: colour('--stack-line-on-light'),
    lineOnDark: colour('--stack-line-on-dark'),
    background: colour('--color-bg'),
    cloud: colour('--stack-cloud'),
    cloudShade: colour('--stack-cloud-shade'),
  };
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
    titleSize: px('--text-sm'),
    titleWeight: v('--weight-bold'),
    bodyFamily: v('--font-body'),
    emojiFamily: v('--font-emoji'),
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
    crossfadeMs: cssDuration(v('--duration-crossfade')) || 0,
    scenery: readScenery(v),
  };
}

/**
 * The colour scheme changed while the pile is open: the same theme object, its tokens read again
 * (everything drawn holds this object, so the next frame uses the new colours).
 */
function rereadTheme(into: BookTheme): void {
  Object.assign(into, readTheme());
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
  depth: number;
  thickness: number;
  /** The covers' own colour (top and bottom faces), until the real cover's is known. */
  cover: string;
  /** The real cover (a display URL), or null. */
  coverUrl: string | null;
  /** The reader's colour. */
  band: string;
}

/** The main canvas's context: opaque, so the compositor needn't blend it with the page. */
function context2d(canvas: HTMLCanvasElement | null, opaque: boolean): CanvasRenderingContext2D | null {
  return canvas?.getContext('2d', opaque ? { alpha: false } : undefined) ?? null;
}

/**
 * A spine at `scale` canvas pixels per px: the book's colour (its cover's, `fill`, when known) and
 * shade, the reader's band and avatar, then the title.
 */
function renderSpine(
  book: BookPaint,
  theme: BookTheme,
  scale: number,
  plainAvatar = false,
  fill: string | null = null,
  size: { width: number; thickness: number } = book,
  textScale = 1,
): HTMLCanvasElement {
  const { width: w, thickness: t } = size;
  // Text scaled to the book's thickness (cover shapes); 1: the theme's own fonts, as before.
  const titleFont = textScale === 1 ? theme.titleFont : `${theme.titleWeight} ${theme.titleSize * textScale}px ${theme.bodyFamily}`;
  const avatarFont = textScale === 1 ? theme.avatarFont : `${theme.avatarSize * textScale}px ${theme.emojiFamily}`;
  const avatarSize = theme.avatarSize * textScale;
  const canvas = document.createElement('canvas');
  canvas.width = backingSize(w, scale);
  canvas.height = backingSize(t, scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(canvas.width / w, canvas.height / t);
  ctx.fillStyle = fill ?? hsl(book.spineHue, theme.spineSaturation, theme.spineLightness);
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
    const r = avatarSize / 2;
    ctx.fillStyle = book.band;
    ctx.beginPath();
    ctx.arc(x + r, t / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.onBook;
    ctx.font = titleFont;
    ctx.textAlign = 'center';
    ctx.fillText((graphemes(book.title)[0] ?? '').toUpperCase(), x + r, t / 2);
    ctx.textAlign = 'start';
    x += avatarSize + theme.gap;
  } else {
    ctx.font = avatarFont;
    ctx.fillText(book.avatar, x, t / 2);
    x += ctx.measureText(book.avatar).width + theme.gap;
  }
  ctx.font = titleFont;
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

/** The cloud sprites: one canvas (one texture), a cell per shape, each `cell` backing px tall, `stride` apart. */
interface CloudAtlas {
  canvas: HTMLCanvasElement;
  width: number;
  cell: number;
  stride: number;
}

/**
 * The cloud shapes as sprites in one atlas, CLOUD_WIDTH[1] wide at `scale`: each shape's puffs
 * and base bar in the shade, then again a little higher in the lit colour, so a shaded rim shows
 * underneath, cut flat at the base. Drawn once per resolution and theme; never read back.
 */
function renderCloudAtlas(scale: number, lit: string, shade: string): CloudAtlas {
  const width = CLOUD_WIDTH[1];
  const canvas = document.createElement('canvas');
  const cell = backingSize(width * CLOUD_ASPECT, scale);
  // A clear row between cells, so a scaled draw never picks up its neighbour's edge.
  const stride = cell + 2;
  canvas.width = backingSize(width, scale);
  canvas.height = stride * CLOUD_SHAPES.length;
  const atlas = { canvas, width: canvas.width, cell, stride };
  const ctx = canvas.getContext('2d');
  if (!ctx) return atlas;
  CLOUD_SHAPES.forEach((shape, k) => {
    ctx.save();
    // In sprite widths: the shapes' own units.
    ctx.setTransform(scale * width, 0, 0, scale * width, 0, k * stride);
    ctx.beginPath();
    ctx.rect(0, 0, 1, CLOUD_BASE);
    ctx.clip();
    const first = shape[0];
    const last = shape[shape.length - 1];
    const fill = (colour: string, rise: number, grow: number) => {
      ctx.beginPath();
      ctx.rect(first.x, CLOUD_BASE - CLOUD_BAR - rise, last.x - first.x, CLOUD_BAR);
      for (const p of shape) {
        ctx.moveTo(p.x + p.r * grow, p.y - rise);
        ctx.arc(p.x, p.y - rise, p.r * grow, 0, Math.PI * 2);
      }
      ctx.fillStyle = colour;
      ctx.fill();
    };
    fill(shade, 0, 1);
    fill(lit, CLOUD_SHADE_RISE, 0.97);
    ctx.restore();
  });
  return atlas;
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
  /** Less than 1 while its book's markers fade in after landing. */
  alpha: number;
}

interface Paint {
  /** Page-edge stripes, by book thickness. */
  pages: Map<number, HTMLCanvasElement>;
  coverShade: CanvasGradient | null;
  scale: number;
  /** The sky's gradients by altitude (a unit square, placed by the transform), or null without a sky. */
  sky: SkyGradients<CanvasGradient> | null;
  /** The meadow from the horizon (0) to the contact line, and the haze above the horizon (CSS px), or null without ground. */
  ground: CanvasGradient | null;
  haze: CanvasGradient | null;
  /** The cloud sprites (one atlas) at this scale, made the first time a cloud is drawn. */
  clouds: CloudAtlas | null;
}

/** The scenery's gradients for this theme (rebuilt with the paint when the scale or the colours change). */
function sceneryPaint(ctx: CanvasRenderingContext2D, theme: BookTheme): Pick<Paint, 'sky' | 'ground' | 'haze'> {
  const sc = theme.scenery;
  const palette = sc.sky;
  const sky = palette
    ? new SkyGradients<CanvasGradient>((stops) => {
        const g = ctx.createLinearGradient(0, 0, 0, 1);
        for (const stop of stops) g.addColorStop(stop.offset, cssColour(skyColour(stop.t, palette)));
        return g;
      })
    : null;
  let ground: CanvasGradient | null = null;
  let haze: CanvasGradient | null = null;
  if (sc.ground && sc.groundFar) {
    // Both in unit lengths: each frame stretches them to its view's ground (groundSize).
    ground = ctx.createLinearGradient(0, 0, 0, 1);
    ground.addColorStop(0, cssColour(sc.groundFar));
    ground.addColorStop(1, cssColour(sc.ground));
    if (sc.horizon) {
      haze = ctx.createLinearGradient(0, -1, 0, 0);
      haze.addColorStop(0, cssColour(sc.horizon, 0));
      haze.addColorStop(1, cssColour(sc.horizon));
    }
  }
  return { sky, ground, haze };
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
  /** The real covers' colours and pictures, or null with covers off. */
  art: CoverArt | null;
  /** This frame's time (performance.now()), for the covers' fades. */
  now: number;
  /** Set when a cover drawn this frame is still fading in (another frame is wanted). */
  fading: boolean;
  /** Cover shapes: labels and page edges per size bucket, spine text scaled to the thickness. */
  shaped: boolean;
  /** Books from the camera whose page faces have full lines this frame (pageLineAlpha). */
  pageRange: number;
}

const NO_FADE: CoverFade = { colour: 1, picture: 1, shape: 1 };

/** A book's cover fade this frame (noting in the kit when one is still running). */
function coverFade(book: BookPaint, kit: FaceKit): CoverFade {
  if (!kit.art || !book.coverUrl) return NO_FADE;
  const f = kit.art.fade(book.coverUrl, kit.now);
  if (f.colour < 1 || f.picture < 1) kit.fading = true;
  return f;
}

/**
 * A spine label from the cache, prepared (and timed) if it isn't there. A cover's colour arriving
 * makes it a new label; `own` asks for the book's own colour (the label a fade starts from).
 */
function spineLabel(book: BookPaint, kit: FaceKit, own = false, shape: { width: number; thickness: number } = book): HTMLCanvasElement {
  const tint = own ? null : (kit.art?.colour(book.coverUrl) ?? null);
  // With cover shapes a label is drawn for its size bucket (a few per book at most, also while a
  // shape eases in) and stretched to the face; the text is fitted to that spine.
  const size = kit.shaped ? { width: sizeBucket(shape.width, WIDTH_BUCKET), thickness: sizeBucket(shape.thickness, THICKNESS_BUCKET) } : book;
  const sized = kit.shaped ? `${book.labelKey}\u0000${size.width}x${size.thickness}` : book.labelKey;
  const key = tint ? `${sized}\u0000${tint.spine}` : sized;
  let spine = kit.labels.get(key);
  if (!spine) {
    const started = performance.now();
    spine = renderSpine(book, kit.theme, kit.scale, kit.plainAvatars, tint?.spine ?? null, size, kit.shaped ? spineTextScale(size.thickness) : 1);
    kit.labels.set(key, spine);
    kit.prep.ms += performance.now() - started;
    kit.prep.count += 1;
  }
  return spine;
}

/** A face's two lower corners on screen (px), left then right: where a landing book's dust puffs from. */
function lowerCorners(face: ProjectedFace): { left: { x: number; y: number }; right: { x: number; y: number } } {
  const { origin: o, u, v } = face;
  const pts = [
    { x: o.x, y: o.y },
    { x: o.x + u.x, y: o.y + u.y },
    { x: o.x + v.x, y: o.y + v.y },
    { x: o.x + u.x + v.x, y: o.y + u.y + v.y },
  ].sort((a, b) => b.y - a.y);
  const [a, b] = pts;
  return a.x <= b.x ? { left: a, right: b } : { left: b, right: a };
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
function drawFace(ctx: CanvasRenderingContext2D, face: ProjectedFace, book: BookPaint, shape: BookShape, fromCamera: number, kit: FaceKit) {
  const { scale, theme, paint } = kit;
  if (face.side === 'front') {
    const fade = coverFade(book, kit);
    const spine = spineLabel(book, kit, false, shape);
    ctx.setTransform(...faceTransform(face, scale));
    if (fade.colour < 1) {
      // A cover's colour arriving on screen: the book's own spine, the new one fading in over it.
      ctx.drawImage(spineLabel(book, kit, true, shape), 0, 0, face.width, face.height);
      ctx.globalAlpha = fade.colour;
      ops += 1;
    }
    ctx.drawImage(spine, 0, 0, face.width, face.height);
    ctx.globalAlpha = 1;
    ops += 1;
  } else if (face.side === 'top' || face.side === 'bottom') {
    const { origin: o, u, v } = face;
    const fade = coverFade(book, kit);
    // Every drawn book's top face shows the real cover's picture, unless the face is too thin on
    // screen (coverPlan.showsPicture): one affine drawImage, which maps its crop exactly onto the
    // face. The cover's top is at the spine's left end and its spine edge towards the reader (v),
    // as on a real book lying front up: image x runs from the spine edge to the back (-v), image
    // y along the spine (u). A turn, not a mirror.
    const picture = face.side === 'top' && kit.art && showsPicture(faceThickness(face)) ? kit.art.picture(book.coverUrl) : null;
    // In the face's unit square, so the one cover gradient fits every book.
    const unit = () => ctx.setTransform(u.x * scale, u.y * scale, v.x * scale, v.y * scale, o.x * scale, o.y * scale);
    unit();
    if (!picture || fade.picture < 1) {
      // The flat cover: the book's own colour, or its cover's (fading in over it as it arrives).
      const tint = kit.art?.colour(book.coverUrl) ?? null;
      if (tint && fade.colour < 1) {
        ctx.fillStyle = book.cover;
        ctx.fillRect(0, 0, 1, 1);
        ctx.globalAlpha = fade.colour;
        ops += 1;
      }
      ctx.fillStyle = tint?.cover ?? book.cover;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalAlpha = 1;
      ops += 1;
    }
    if (picture) {
      const crop = coverCrop(picture.width, picture.height, shape.width, shape.depth);
      ctx.setTransform(-v.x * scale, -v.y * scale, u.x * scale, u.y * scale, (o.x + v.x) * scale, (o.y + v.y) * scale);
      ctx.globalAlpha = fade.picture;
      // A Google thumbnail's copy (loaded without CORS) taints this canvas: it's never read (pixelGuard.ts).
      if (picture.tainted) markTainted(ctx.canvas);
      ctx.drawImage(picture.image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 1, 1);
      ctx.globalAlpha = 1;
      ops += 1;
      unit();
    }
    if (face.side === 'top' && paint.coverShade) {
      ctx.fillStyle = paint.coverShade;
      ctx.fillRect(0, 0, 1, 1);
      ops += 1;
    }
  } else {
    // Page edges: the cached stripes (one drawImage) within the range, the flat paper with an
    // outline past it or edge-on, and the stripes fading in over the flat face in between.
    const lines = pageLineAlpha(fromCamera, faceThickness(face), kit.pageRange);
    if (lines < 1) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      tracePath(ctx, face);
      ctx.fillStyle = theme.pages;
      ctx.fill();
      ctx.strokeStyle = theme.pageLine;
      ctx.lineWidth = theme.borderThin;
      ctx.stroke();
      ops += 2;
    }
    if (lines > 0) {
      const thickness = kit.shaped ? sizeBucket(shape.thickness, THICKNESS_BUCKET) : book.thickness;
      let pages = paint.pages.get(thickness);
      if (!pages) {
        pages = renderPages(thickness, theme, scale);
        paint.pages.set(thickness, pages);
      }
      ctx.setTransform(...faceTransform(face, scale));
      ctx.globalAlpha = lines;
      ctx.drawImage(pages, 0, 0, face.width, face.height);
      ctx.globalAlpha = 1;
      ops += 1;
    }
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
  shapeAt: (index: number) => { width: number; depth: number },
  paints: readonly BookPaint[],
  theme: BookTheme,
) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, side, side);
  const mid = side / 2;
  const k = (side - 2 * theme.gap) / INSET_SPAN;
  const footprint = (index: number) => {
    const { width: w, depth: d } = shapeAt(index);
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

/** Each cover's books (indexes, oldest first): a cover can be on more than one book (two readers' copies). */
function coverIndexes(items: readonly StackItem[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  items.forEach((item, i) => {
    if (!item.cover) return;
    const list = out.get(item.cover);
    if (list) list.push(i);
    else out.set(item.cover, [i]);
  });
  return out;
}

/**
 * Ask the loader for covers (coverPlan.coverJobs): the drawn books first, then pictures ahead
 * of the camera, then colours outwards from it.
 */
function askCovers(
  loader: CoverArt | null,
  items: readonly StackItem[],
  indexes: ReadonlyMap<string, readonly number[]>,
  centre: number,
  from: number,
  to: number,
  travel: Travel,
) {
  if (!loader) return;
  const wishes: CoverWish[] = [];
  for (const job of coverJobs(centre, from, to, items.length, travel)) {
    const item = items[job.index];
    if (item.cover) wishes.push({ url: item.cover, isbn: item.isbn, picture: job.picture });
  }
  const drawn = new Set<string>();
  for (let i = Math.max(0, from); i < Math.min(items.length, to); i++) {
    const url = items[i].cover;
    if (url) drawn.add(url);
  }
  const distanceOf = (url: string) => {
    let best = Infinity;
    for (const i of indexes.get(url) ?? []) best = Math.min(best, Math.abs(i - centre));
    return best;
  };
  loader.want({ wishes, drawn, distanceOf });
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
  paused = false,
  covers = false,
  reportCovers = false,
  coverShapes = false,
  gap = false,
  sky = false,
  ground = false,
  clouds = false,
  foreground = true,
  decor = 'full',
  pretendSlow = false,
  drop = null,
  liveDrops = false,
  onLanding,
  onDropEnd,
  onScroller,
  onScroll,
  onDraw,
  onBench,
}: CanvasStackProps) {
  const count = items.length;
  // Cover shapes: thickness from the book (its ISBN), the standard footprint until its cover's shape is known.
  const shapes = useMemo(() => items.map((item) => pileShape(coverShapes, seed, item)), [items, seed, coverShapes]);
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
          depth: shapes[i].depth,
          thickness: shapes[i].thickness,
          cover: hsl(hue, theme.spineSaturation, theme.coverLightness),
          coverUrl: item.cover ?? null,
          band,
        };
      }),
    [items, shapes, theme],
  );
  const covered = useMemo(() => coverIndexes(items), [items]);
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
  const paint = useRef<Paint>({ pages: new Map(), coverShade: null, scale: 0, sky: null, ground: null, haze: null, clouds: null });
  /** This frame's projected books, by offset from the centre book minus FAN_CAP (reused every frame). */
  const scratch = useRef<(ProjectedBook | null)[]>(Array.from({ length: 2 * FAN_CAP + 1 }, () => null));
  /** This frame's book shapes (cover shapes easing in), by the same offset (reused every frame). */
  const liveShapes = useRef<(BookShape | null)[]>(Array.from({ length: 2 * FAN_CAP + 1 }, () => null));
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
    /** Nor the decor (clouds) above this: slow frames lower it first (drawBudget.nextBudget). */
    decorCap: 'full' as Decor,
    /** Nor the page lines past this (slow frames cut them back after the decor), and the range now (easing to it) and when it was last eased. */
    pagesCap: 'all' as PageLines,
    pageRange: Number.NaN,
    pageRangeAt: 0,
    /** The budget's time for the moving frames since the last decision (ms; "Pretend slow frames" makes it more). */
    motionCost: 0,
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
    saved: null as { scale: number; scaleCap: number; decorCap: Decor; pagesCap: PageLines; scrollTop: number } | null,
    listener: null as ((stats: DrawStats) => void) | null,
    /** Drawing is paused (the pile is covered); `missed`: a frame was skipped meanwhile. */
    paused,
    missed: false,
    /** The window the covers were last asked for (centre, from, to), and the pending ask. */
    coverAsk: '',
    coverTimer: 0,
    coverWindow: { ask: '', centre: 0, from: 0, to: 0, travel: 0 as Travel },
    /** The latest frame's drawn books [from, to) and where `scratch` starts (book base), for the Cover diagnostics. */
    drawnRange: { base: 0, from: 0, to: 0 },
    /** The frame asked for while a cover fades in (when the camera isn't moving anyway), and what it does. */
    fadeRaf: 0,
    fadeFrame: () => {},
    /** New books falling, or highlighted, and the frame asked for them. */
    drop: null as DropRun | null,
    highlight: null as HighlightRun | null,
    dropRaf: 0,
    dropFrame: (now: number) => void now,
  });
  /** The real covers' loader, while `covers` is on. */
  const art = useRef<CoverArt | null>(null);
  // What the next frame draws: kept in a ref so scrolling never waits on React.
  const scene = useRef({
    items,
    shapes,
    centres,
    paints,
    covered,
    markers,
    onCentre,
    twist,
    gap,
    sky,
    ground,
    clouds,
    foreground,
    decor,
    pretendSlow,
    seed,
    settle,
    describeCentre,
    measureRaster,
    onDraw,
    drop,
    liveDrops,
    onLanding,
    onDropEnd,
    coverShapes,
  });
  useLayoutEffect(() => {
    scene.current = {
      items,
      shapes,
      centres,
      paints,
      covered,
      markers,
      onCentre,
      twist,
      gap,
      sky,
      ground,
      clouds,
      foreground,
      decor,
      pretendSlow,
      seed,
      settle,
      describeCentre,
      measureRaster,
      onDraw,
      drop,
      liveDrops,
      onLanding,
      onDropEnd,
      coverShapes,
    };
  });
  /** This frame's marker labels and month lines (reused every frame). */
  const placed = useRef({ sprites: [] as PlacedSprite[], lines: [] as number[], lineAlpha: [] as number[] });

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
      if (cam.current.paused) {
        cam.current.missed = true;
        return;
      }
      const ctx = context2d(canvas.current, true);
      if (!ctx) return;
      const started = performance.now();
      ops = 0;
      const c = cam.current;
      const { width, height, scale } = size.current;
      const { items, shapes, centres, paints, markers, onCentre, describeCentre, measureRaster, onDraw } = scene.current;
      const o = c.overrides;
      const twist = o ? o.twist : scene.current.twist;
      const gapOn = scene.current.gap;
      const overlays = o ? o.overlays : true;
      if (paint.current.scale !== scale) {
        if (paint.current.scale !== 0) c.rebuilds += 1;
        labels.clear();
        sprites.clear();
        // The cover's shade runs across a face's unit square, towards the spine.
        const coverShade = ctx.createLinearGradient(0, 0, 0, 1);
        coverShade.addColorStop(0.6, 'transparent');
        coverShade.addColorStop(1, theme.shade);
        paint.current = { pages: new Map(), coverShade, scale, ...sceneryPaint(ctx, theme), clouds: null };
      }

      const s = c.shown;
      const total = items.length;
      // The scenery first (scenery.ts): the sky by altitude, then the meadow from its horizon down.
      const sc = theme.scenery;
      const skyOn = scene.current.sky && paint.current.sky !== null;
      const groundOn = scene.current.ground && paint.current.ground !== null;
      const contact = groundContactY(centres, s, bookLift(0, s, gapOn), height / 2);
      const groundBand = groundSize(height);
      const meadow = SCENE_DROP * groundBand.depth;
      const horizon = Math.round(horizonY(contact, groundBand.depth) * scale) / scale;
      const skyNow = skyOn ? viewSky(horizon, height, groundOn) : null;
      const groundNow = groundOn && groundInView(horizon, height);
      if (skyNow && paint.current.sky) {
        // One gradient from the top of the view to the horizon (or the bottom), kept by altitude.
        ctx.setTransform(1, 0, 0, skyNow.bottom * scale, 0, 0);
        ctx.fillStyle = paint.current.sky.get(skyNow.tTop, skyNow.tBottom);
        ctx.fillRect(0, 0, ctx.canvas.width, 1);
        ops += 1;
      } else if (!groundNow || horizon > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ops += 1;
      }
      // The backdrop clouds (clouds.ts), behind the ground so the meadow hides any behind the horizon.
      const decorNow = o ? { decor: o.decor, why: 'fixed' as DecorWhy } : decorInEffect(scene.current.decor, c.decorCap, c.reduced);
      // Which layers: the backdrop (the still layer with reduced motion) and, with Full decor, the wisps.
      const layers: CloudLayer[] =
        skyNow && scene.current.clouds && sc.cloud && sc.cloudShade ? cloudLayers(decorNow.decor, c.reduced, scene.current.foreground) : NO_LAYERS;
      const cloudsOf = (layer: CloudLayer): PlacedCloud[] => {
        if (!layers.includes(layer) || !sc.cloud || !sc.cloudShade) return NO_CLOUDS;
        const list = placeClouds(
          {
            seed: scene.current.seed,
            width,
            height,
            horizon,
            ground: groundNow,
            decor: decorNow.decor,
            reduced: c.reduced,
            eyeReach: eyeLineReach(scene.current.coverShapes ? BIGGEST_SHAPED_BOOK : BIGGEST_BOOK, theme.gutter),
          },
          layer,
        );
        if (list.length === 0) return NO_CLOUDS;
        const atlas = (paint.current.clouds ??= renderCloudAtlas(scale, cssColour(sc.cloud), cssColour(sc.cloudShade)));
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        for (const cloud of list) {
          ctx.globalAlpha = cloud.alpha;
          ctx.drawImage(atlas.canvas, 0, cloud.shape * atlas.stride, atlas.width, atlas.cell, cloud.x, cloud.y, cloud.width, cloud.height);
          ops += 1;
        }
        ctx.globalAlpha = 1;
        return list;
      };
      // Behind the ground: the meadow hides any cloud behind the horizon.
      const backdrop = cloudsOf(c.reduced ? 'still' : 'backdrop');
      if (groundNow && paint.current.ground) {
        // From the horizon down: the haze above its line, the meadow (hazier far off), the line.
        if (paint.current.haze && horizon > 0) {
          ctx.setTransform(scale, 0, 0, scale * groundBand.haze, 0, horizon * scale);
          ctx.fillStyle = paint.current.haze;
          ctx.fillRect(0, -1, width, 1);
          ops += 1;
        }
        ctx.setTransform(scale, 0, 0, scale * meadow, 0, horizon * scale);
        ctx.fillStyle = paint.current.ground;
        ctx.fillRect(0, 0, width, (height - horizon) / meadow);
        ops += 1;
        if (sc.horizon && horizon >= 0) {
          ctx.setTransform(scale, 0, 0, scale, 0, horizon * scale);
          ctx.fillStyle = cssColour(sc.horizon);
          ctx.fillRect(0, 0, width, theme.borderThin);
          ops += 1;
        }
      }
      // The wisps in front of the backdrop and the ground, and still behind every book.
      const wisps = cloudsOf('foreground');
      const clouds = wisps.length > 0 ? [...backdrop, ...wisps] : backdrop;
      /** What's behind a month line at `y`: the ground below the horizon, the sky (or the page) above it. */
      const behind = (y: number): Rgba | null => {
        if (groundNow && y >= horizon && sc.ground && sc.groundFar) return mix(sc.groundFar, sc.ground, (y - horizon) / meadow);
        if (skyNow && sc.sky) return skyColour(skyT(altitudeAt(y, horizon)), sc.sky);
        return null;
      };
      let faces = 0;
      let from = 0;
      let to = 0;
      const prep = { ms: 0, count: 0 };
      let kit: FaceKit | null = null;
      let shapeFading = false;
      const booksStart = performance.now();
      const centre = total > 0 ? Math.round(clampPosition(s, total)) : -1;
      if (centre >= 0) {
        const originY = height / 2;
        const view: View = { camera: FAN_CAMERA, originX: width / 2, originY };
        const books = scratch.current;
        books.fill(null);
        const base = centre - FAN_CAP;
        const dw = c.drop?.world ?? null;
        const shaped = scene.current.coverShapes;
        const live = liveShapes.current;
        live.fill(null);
        /** Book `i`'s shape this frame: with cover shapes, its cover's footprint (easing in when it has just arrived). */
        const shapeAt = (i: number): BookShape => {
          const at = i - base;
          const cached = at >= 0 && at < live.length ? live[at] : null;
          if (cached) return cached;
          let shape = shapes[i];
          const url = paints[i]?.coverUrl ?? null;
          const aspect = shaped && art.current && url ? art.current.aspect(url) : null;
          if (aspect !== null) {
            let fp = coverFootprint(aspect);
            const p = art.current?.fade(url, started).shape ?? 1;
            if (p < 1) {
              fp = easeFootprint({ width: STANDARD_WIDTH, depth: STANDARD_DEPTH }, fp, p);
              shapeFading = true;
            }
            shape = { ...shape, width: fp.width, depth: fp.depth };
          }
          if (at >= 0 && at < live.length) live[at] = shape;
          return shape;
        };
        /** A book's lift from the drop (in the air, less the pile's push), 0 without a drop. */
        const fall = (i: number) => (dw ? dropLift(dw, i) : 0);
        const projectAt = (i: number): ProjectedBook => {
          let book = books[i - base];
          if (!book) {
            let shape = shapeAt(i);
            let lift = bookLift(i, s, gapOn) + fall(i);
            const sq = dw?.squash.get(i);
            if (sq) {
              // Squashed on landing: thinner and a little wider, its bottom where it was.
              const k = squashScale(sq);
              shape = { ...shape, thickness: shape.thickness * k.thickness, width: shape.width * k.footprint, depth: shape.depth * k.footprint };
              lift -= (shapes[i].thickness - shape.thickness) / 2;
            }
            book = projectBook(fannedBook(i, items[i].step, shape, centres, s, twist, lift, dw ? dropSpin(dw, i) : 0), view);
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
        c.drawnRange = { base, from, to };
        // The page lines' range: every drawn book, unless slow frames cut it back (eased, so it never jumps).
        const pagesTarget = PAGE_RANGE[o ? 'all' : c.pagesCap];
        c.pageRange = easePageRange(c.pageRange, pagesTarget, started - c.pageRangeAt, c.reduced);
        c.pageRangeAt = started;
        if (c.pageRange !== pagesTarget) shapeFading = true;
        kit = {
          scale,
          labels,
          theme,
          paint: paint.current,
          plainAvatars: o?.plainAvatars ?? false,
          prep,
          art: art.current,
          now: started,
          fading: false,
          shaped: scene.current.coverShapes,
          pageRange: c.pageRange,
        };
        const marks = placed.current;
        marks.sprites.length = 0;
        marks.lines.length = 0;
        marks.lineAlpha.length = 0;
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
          const put = (sp: Sprite, x: number, y: number, alpha: number) => {
            const top = markerTop({ x, y, width: sp.width, height: sp.height }, middle, height, theme.padY);
            marks.sprites.push({ sprite: sp, x: Math.round(x * scale) / scale, y: Math.round(top * scale) / scale, alpha });
          };
          for (let k = firstMarkerFrom(markers.months, from); k < markers.months.length && markers.months[k].index < to; k++) {
            const m = markers.months[k];
            // A falling book's markers wait until it lands, then fade in.
            const alpha = dw ? markerAlpha(dw, m.index) : 1;
            if (alpha <= 0) continue;
            const between = m.index > 0 ? (fall(m.index) + fall(m.index - 1)) / 2 : fall(m.index);
            const y = spineLevels(m.index, shapeAt(m.index), centres, s, twist, originY, lineLift(m.index, s, gapOn) + between).bottom;
            if (y < 0 || y > height) continue;
            marks.lines.push(y);
            marks.lineAlpha.push(alpha);
            const key = `m\u0000${m.big ? 1 : 0}\u0000${m.parts.map((p) => p.text).join('')}`;
            const sp = sprite(key, () => renderSprite(monthParts(m.parts, m.big, theme), theme.surface, theme.text, theme.border, theme, scale));
            put(sp, width - theme.gutter - sp.width, y - theme.padY - sp.height, alpha);
          }
          for (let k = firstMarkerFrom(markers.flags, from); k < markers.flags.length && markers.flags[k].index < to; k++) {
            const f = markers.flags[k];
            const alpha = dw ? markerAlpha(dw, f.index) : 1;
            if (alpha <= 0) continue;
            const y = spineLevels(f.index, shapeAt(f.index), centres, s, twist, originY, bookLift(f.index, s, gapOn) + fall(f.index)).middle;
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
            put(sp, theme.gutter, y - sp.height / 2, alpha);
          }
        }
        const drawSprites = (list: readonly PlacedSprite[]) => {
          if (list.length === 0) return;
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          for (const { sprite: sp, x, y, alpha } of list) {
            ctx.globalAlpha = alpha;
            ctx.drawImage(sp.canvas, x, y, sp.width, sp.height);
            ops += 1;
          }
          ctx.globalAlpha = 1;
        };
        if (groundNow && !(dw && waiting(dw, 0))) {
          // The base book's soft shadow on the ground: its footprint at height 0, turned with it.
          const base0 = shapeAt(0);
          const reach = (SCENE_DROP * Math.hypot(base0.width, base0.depth)) / 2 + SHADOW_SPREAD[0].along + SHADOW_FORWARD;
          // A first book falling onto the ground: its shadow grows as it comes down.
          const strength = shadowStrength(fall(0));
          if (strength > 0 && shadowInView(contact, height, reach)) {
            const yaw = relativeYaw(0, s, twist) + (dw ? dropSpin(dw, 0) : 0);
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.fillStyle = sc.shadow;
            SHADOW_SPREAD.forEach((spread, k) => {
              const corners = groundShadowFootprint(base0, yaw, contact, width / 2, spread, SHADOW_FORWARD);
              ctx.globalAlpha = (k === 0 ? SHADOW_OUTER_ALPHA : 1) * strength;
              ctx.beginPath();
              corners.forEach((p, n) => (n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
              ctx.closePath();
              ctx.fill();
              ops += 1;
            });
            ctx.globalAlpha = 1;
          }
        }
        // Bottom of the pile first: index order is painter's order (stackProjection's drawOrder).
        const hl = c.highlight;
        const pulse = hl ? highlightAlpha(started - hl.from) : 0;
        for (let i = from; i < to; i++) {
          // A new book not yet let go isn't there yet.
          if (dw && waiting(dw, i)) continue;
          const book = projectAt(i);
          // Ready each spine as its book comes into the window, even facing away, so a turn of
          // the fan never has many spines to draw in one frame.
          const shape = shapeAt(i);
          spineLabel(paints[i], kit, false, shape);
          for (const face of book.faces) drawFace(ctx, face, paints[i], shape, i - s, kit);
          faces += book.faces.length;
          if (hl && pulse > 0 && i >= hl.start && i < hl.end) {
            // A new book shown without falling: a calm outline pulse.
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = theme.milestone;
            ctx.lineWidth = theme.borderThick;
            for (const face of book.faces) {
              tracePath(ctx, face);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ops += book.faces.length;
          }
        }
        if (dw && dw.dust.length > 0) {
          // Dust from the landing books' lower corners: small circles, fading.
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.fillStyle = theme.pages;
          const corners = new Map<number, { left: { x: number; y: number }; right: { x: number; y: number } } | null>();
          for (const d of dw.dust) {
            if (d.index < from || d.index >= to) continue;
            let at = corners.get(d.index);
            if (at === undefined) {
              const front = projectAt(d.index).faces.find((f) => f.side === 'front');
              at = front ? lowerCorners(front) : null;
              corners.set(d.index, at);
            }
            if (!at) continue;
            const corner = d.side < 0 ? at.left : at.right;
            ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.8;
            ctx.beginPath();
            ctx.arc(corner.x + d.x, corner.y + d.y, d.r, 0, Math.PI * 2);
            ctx.fill();
            ops += 1;
          }
          ctx.globalAlpha = 1;
        }
        if (marks.lines.length > 0) {
          // Month lines across the pile, in one dashed stroke (a landing book's fading in on its own).
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.setLineDash([theme.dash, theme.dashGap]);
          ctx.lineWidth = theme.borderThin;
          const line = (y: number) => {
            const at = (Math.round(y * scale) + 0.5) / scale;
            ctx.moveTo(theme.gutter, at);
            ctx.lineTo(width - theme.gutter, at);
          };
          // Over the scenery each line takes whichever ink contrasts more with what's behind it
          // (the sky or ground, and any cloud it crosses); where neither ink is clear of a cloud,
          // the line gets a casing in the other ink under its dashes.
          const casings: string[] = [];
          const inkOf = (y: number, k: number): string => {
            const back = behind(y);
            casings[k] = '';
            if (!back || !sc.lineOnLight || !sc.lineOnDark) return theme.insetLine;
            const under = [back];
            for (const cloud of clouds) {
              if (y < cloud.y || y > cloud.y + CLOUD_BASE * cloud.width || !sc.cloud || !sc.cloudShade) continue;
              under.push(mix(back, sc.cloud, cloud.alpha), mix(back, sc.cloudShade, cloud.alpha));
            }
            const style = lineStyle(under, sc.lineOnLight, sc.lineOnDark);
            const [ink, other] = style.ink === 'light' ? [sc.lineOnLight, sc.lineOnDark] : [sc.lineOnDark, sc.lineOnLight];
            if (style.cased) casings[k] = cssColour(other);
            return cssColour(ink);
          };
          const inks = marks.lines.map(inkOf);
          if (casings.some(Boolean)) {
            ctx.lineWidth = theme.borderThin + 2 * theme.borderThin;
            marks.lines.forEach((y, k) => {
              if (!casings[k]) return;
              ctx.globalAlpha = marks.lineAlpha[k];
              ctx.strokeStyle = casings[k];
              ctx.beginPath();
              line(y);
              ctx.stroke();
              ops += 1;
            });
            ctx.globalAlpha = 1;
            ctx.lineWidth = theme.borderThin;
          }
          for (const ink of new Set(inks)) {
            ctx.strokeStyle = ink;
            ctx.beginPath();
            marks.lines.forEach((y, k) => marks.lineAlpha[k] >= 1 && inks[k] === ink && line(y));
            ctx.stroke();
            ops += 1;
          }
          marks.lines.forEach((y, k) => {
            if (marks.lineAlpha[k] >= 1) return;
            ctx.globalAlpha = marks.lineAlpha[k];
            ctx.strokeStyle = inks[k];
            ctx.beginPath();
            line(y);
            ctx.stroke();
            ops += 1;
          });
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
        drawSprites(marks.sprites);
        if (centre !== c.centre) {
          c.centre = centre;
          onCentre?.(items[centre], centre);
        }
        // The covers near the camera are asked for after this frame (never loaded in it).
        const travel = travelOf(c.shown, c.target);
        const ask = `${centre}:${from}:${to}:${travel}`;
        c.coverWindow = { ask, centre, from, to, travel };
        if (art.current && ask !== c.coverAsk && !c.coverTimer) {
          c.coverTimer = window.setTimeout(() => {
            // The latest frame's window (frames drawn meanwhile included).
            c.coverTimer = 0;
            const w = c.coverWindow;
            c.coverAsk = w.ask;
            askCovers(art.current, scene.current.items, scene.current.covered, w.centre, w.from, w.to, w.travel);
          }, 0);
        }
      }
      // A cover (or its shape) still fading in: one more frame (the camera's own frames draw it while it moves).
      if ((kit?.fading || shapeFading) && !c.fadeRaf) {
        c.fadeRaf = requestAnimationFrame(() => {
          c.fadeRaf = 0;
          c.fadeFrame();
        });
      }

      const booksMs = performance.now() - booksStart - prep.ms;
      let raster: number | undefined;
      c.frame += 1;
      if (measureRaster && !settled && c.frame % RASTER_EVERY === 0) {
        const flushStart = performance.now();
        // Skipped once a Google cover (loaded without CORS) has been drawn here.
        if (flushForTiming(ctx)) raster = performance.now() - flushStart;
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
            (i) => liveShapes.current[i - (centre - FAN_CAP)] ?? shapes[i],
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
        covers: onDraw || c.listener ? art.current?.stats() : undefined,
        sky: skyNow ? { top: skyNow.tTop, bottom: skyNow.tBottom } : null,
        ground: groundNow,
        clouds: backdrop.length,
        cloudsFg: wisps.length,
        pages: { level: o ? 'all' : c.pagesCap, range: Number.isFinite(c.pageRange) ? c.pageRange : PAGE_RANGE.all },
        decor: { setting: scene.current.decor, cap: c.decorCap, drawn: decorNow.decor, why: decorNow.why },
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
    if (c.paused) {
      // Nothing is drawn while paused: the camera catches up when drawing resumes.
      c.missed = true;
      return;
    }
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
      // Decor (clouds) goes first, then the resolution (drawBudget.nextBudget).
      if (moving && !scene.current.measureRaster && !c.overrides) {
        c.motionFrames += 1;
        c.motionMs += dt;
        c.motionCost += budgetFrameMs(dt, scene.current.pretendSlow);
        if (budgetDue(c.motionMs, c.motionFrames)) {
          // Only decor that's drawn can be lost: none with the clouds or the sky off.
          const shown = scene.current.clouds && scene.current.sky ? decorInEffect(scene.current.decor, c.decorCap, c.reduced).decor : 'none';
          const next = nextBudget({ decor: shown, pages: c.pagesCap, scale: size.current.scale }, c.motionCost / c.motionFrames, c.motionFrames);
          c.motionFrames = 0;
          c.motionMs = 0;
          c.motionCost = 0;
          if (next.decor !== shown) c.decorCap = next.decor;
          if (next.pages && next.pages !== c.pagesCap) c.pagesCap = next.pages;
          if (next.scale < size.current.scale) {
            c.scaleCap = next.scale;
            applyScale(next.scale);
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
      cs.k = eyeLineBooks(height, scene.current.coverShapes ? BIGGEST_SHAPED_BOOK : BIGGEST_BOOK, theme.restGap, liftAbove(scene.current.gap));
      if (sizer.current) sizer.current.style.height = `${scrollHeight(count, height)}px`;
      if (first) {
        // Opening: the base book if the pile fits above the eye line, else the newest.
        // A drop starts where the pile would open without its new books.
        const opening = scene.current.drop;
        cs.target = cs.shown = opening?.kind === 'fall' ? dropCamera(count - Math.min(count, opening.count), cs.k) : startPosition(count, cs.k);
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
      cancelAnimationFrame(camState.dropRaf);
      camState.dropRaf = 0;
      window.clearTimeout(camState.settleTimer);
      window.clearTimeout(camState.expectedTimer);
    };
  }, [applyScale, draw, theme]);

  // Paused (covered by the book sheet): no frames at all; on resuming, catch up with whatever
  // changed meanwhile (new books, a resize), easing as usual.
  useLayoutEffect(() => {
    const c = cam.current;
    if (c.paused === paused) return;
    c.paused = paused;
    if (paused) {
      cancelAnimationFrame(c.raf);
      c.raf = 0;
      c.last = 0;
      return;
    }
    if (c.missed || c.target !== c.shown) {
      c.missed = false;
      run();
    }
  }, [paused, run]);

  // Developer tools' Cover diagnostics: this pile's covers on demand while it's open, its last
  // report kept as it closes (this cleanup runs before the loader's below is disposed).
  useEffect(() => {
    if (!reportCovers) return;
    const build = (): CoverReport => {
      const { items } = scene.current;
      const loader = art.current;
      const { base, from, to } = cam.current.drawnRange;
      const projected = scratch.current;
      return {
        at: Date.now(),
        books: items.map((item, i) => {
          const drawn = i >= from && i < to;
          const top = drawn ? projected[i - base]?.faces.find((f) => f.side === 'top') : undefined;
          return {
            number: i + 1,
            title: item.title,
            key: item.isbn,
            hasCover: !!item.cover,
            drawn,
            topPx: top ? faceThickness(top) : null,
            cover: loader && item.cover ? loader.describe(item.cover, item.isbn) : null,
          };
        }),
      };
    };
    return provideCoverReport(build);
  }, [reportCovers]);

  // The real covers: a loader while `covers` is on. A colour or picture arriving draws again
  // (unless a frame is coming anyway, or drawing is paused: then it's caught up later).
  useEffect(() => {
    if (!covers) return;
    const c = cam.current;
    const loader = new CoverArt({
      ink: theme.onBook,
      onChange: () => {
        if (!c.raf) draw(true);
      },
      reduced: () => c.reduced,
      fadeMs: theme.crossfadeMs,
      shapes: coverShapes,
    });
    art.current = loader;
    c.coverAsk = '';
    if (!c.raf) draw(true);
    return () => {
      loader.dispose();
      art.current = null;
      window.clearTimeout(c.coverTimer);
      c.coverTimer = 0;
      c.coverAsk = '';
      cancelAnimationFrame(c.fadeRaf);
      c.fadeRaf = 0;
      labels.clear();
      if (!c.raf) draw(true);
    };
  }, [covers, coverShapes, draw, theme, labels]);

  // A cover's fade frame: a draw where the camera is, unless the camera's own frame is coming.
  useEffect(() => {
    const c = cam.current;
    c.fadeFrame = () => {
      if (!c.raf) draw(true);
    };
  }, [draw]);

  // The drop's frames: step the physics, follow the landings with the camera, draw; stop when still.
  useEffect(() => {
    const c = cam.current;
    c.dropFrame = (now: number) => {
      c.dropRaf = 0;
      const { shapes: sh, items: list, onLanding: landed, onDropEnd: ended } = scene.current;
      const d = c.drop;
      if (d) {
        const dt = d.last ? Math.min(50, now - d.last) : 1000 / 60;
        d.last = now;
        const impacts = stepDrop(d.world, dt, (i) => sh[i]?.thickness ?? sh[0]?.thickness ?? 28);
        let first = false;
        for (const hit of impacts) {
          if (!hit.first) continue;
          first = true;
          landed?.({ mass: hit.mass, impulse: hit.impulse });
        }
        const el = scroller.current;
        if (first && d.follow && el) {
          const target = dropCamera(d.base + landedCount(d.world), c.k);
          if (target !== c.target) {
            c.target = target;
            ownScroll(c, el, positionToScroll(target, list.length));
            run();
          }
        }
        if (!dropActive(d.world)) {
          c.drop = null;
          ended?.();
        }
      }
      const h = c.highlight;
      if (h && now - h.from >= HIGHLIGHT_MS) {
        c.highlight = null;
        if (!c.drop) ended?.();
      }
      if (!c.raf) draw(true);
      if (c.drop || c.highlight) c.dropRaf = requestAnimationFrame(c.dropFrame);
    };
  }, [draw, run]);

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

  // The colour scheme changed while the pile is open (light ↔ dark): the tokens again, the
  // labels, markers and scenery redrawn in them (paint.scale 0 rebuilds them on the next frame).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      rereadTheme(theme);
      labels.clear();
      sprites.clear();
      paint.current = { ...paint.current, scale: 0 };
      cam.current.inset = null;
      if (!cam.current.raf) draw(true);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [draw, labels, sprites, theme]);

  // The sky, the ground, the clouds or the decor level changed: draw again where the camera is.
  useEffect(() => {
    if (!cam.current.raf) draw(true);
  }, [sky, ground, clouds, foreground, decor, draw]);

  // The gap switched on or off: K for the new look (where a pile opens next time), and draw again
  // where the camera is (the camera itself stays put).
  useLayoutEffect(() => {
    const c = cam.current;
    c.k = eyeLineBooks(size.current.height, coverShapes ? BIGGEST_SHAPED_BOOK : BIGGEST_BOOK, theme.restGap, liftAbove(gap));
    if (!c.raf) draw(true);
  }, [gap, coverShapes, draw, theme]);

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
    // The reader scrolls: the camera is theirs; a drop carries on without moving it.
    if (c.drop) c.drop.follow = false;
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

  // A drop or highlight asked for (a new `id`): the camera starts where the pile without the new
  // books would open, and the books fall from there.
  const dropId = drop?.id ?? null;
  useEffect(() => {
    const req = scene.current.drop;
    if (dropId === null || !req) return;
    const c = cam.current;
    const total = scene.current.items.length;
    const n = Math.min(total, Math.max(0, Math.floor(req.count)));
    if (n === 0) return;
    const start = total - n;
    if (req.kind === 'fall') {
      jumpTo(positionToScroll(dropCamera(start, c.k), total));
      c.highlight = null;
      c.drop = { world: startDrop(start, total), base: start, follow: true, last: 0 };
    } else {
      c.drop = null;
      c.highlight = { start, end: total, from: performance.now() };
    }
    cancelAnimationFrame(c.dropRaf);
    c.dropRaf = requestAnimationFrame(c.dropFrame);
    return () => {
      cancelAnimationFrame(c.dropRaf);
      c.dropRaf = 0;
    };
  }, [dropId, jumpTo]);

  // New books (or fewer): keep the reader's book in front of them, stay on the base book, or
  // follow the newest book up if that's where they were (stackItems.followPile), without a jump.
  const keys = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    const next = items.map((item) => item.key);
    const prev = keys.current;
    keys.current = next;
    const c = cam.current;
    if (!prev) return;
    // Titles, colours or covers may have changed even when the books haven't: tell onCentre
    // again, and ask for the covers again.
    c.centre = -1;
    c.tag = null;
    c.coverAsk = '';
    const el = scroller.current;
    const same = prev.length === next.length && prev.every((key, i) => key === next[i]);
    if (same || !el) {
      if (!c.raf) draw(true);
      return;
    }
    const grown = next.length > prev.length && prev.every((key, i) => key === next[i]);
    if (c.drop && !grown) {
      // The pile changed under a drop: stop it, books where they are.
      cancelAnimationFrame(c.dropRaf);
      c.dropRaf = 0;
      c.drop = null;
      scene.current.onDropEnd?.();
    }
    if (grown && scene.current.liveDrops && atNewest(c.target, prev.length)) {
      // New books at the top while following the newest: they fall (or are highlighted).
      if (sizer.current) sizer.current.style.height = `${scrollHeight(next.length, size.current.height)}px`;
      window.clearTimeout(c.settleTimer);
      c.settling = false;
      const start = prev.length;
      if (c.reduced || next.length - start > MAX_DROP) {
        const moved = followPile(prev, next, c.target, c.shown);
        c.target = moved.target;
        ownScroll(c, el, positionToScroll(moved.target, next.length));
        c.highlight = { start, end: next.length, from: performance.now() };
        if (!c.dropRaf) c.dropRaf = requestAnimationFrame(c.dropFrame);
        run();
        return;
      }
      // The camera stays on the old newest book and follows them up as they land.
      ownScroll(c, el, positionToScroll(c.target, next.length));
      if (c.drop) addFallers(c.drop.world, start, next.length);
      else c.drop = { world: startDrop(start, next.length), base: start, follow: true, last: 0 };
      if (!c.dropRaf) c.dropRaf = requestAnimationFrame(c.dropFrame);
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
        if (next && !c.overrides) c.saved = { scale: size.current.scale, scaleCap: c.scaleCap, decorCap: c.decorCap, pagesCap: c.pagesCap, scrollTop: c.scrollTop };
        // A bigger label cache while benchmarking, the normal one afterwards.
        labels.resize(next ? Math.max(LABEL_CACHE_SIZE, next.labelCache) : LABEL_CACHE_SIZE);
        const plainChanged = (c.overrides?.plainAvatars ?? false) !== (next?.plainAvatars ?? false);
        c.overrides = next;
        c.motionFrames = 0;
        c.motionMs = 0;
        c.motionCost = 0;
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
          c.decorCap = saved.decorCap;
          c.pagesCap = saved.pagesCap;
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
          art: art.current,
          now: performance.now(),
          fading: false,
          shaped: scene.current.coverShapes,
          pageRange: Number.isFinite(c.pageRange) ? c.pageRange : PAGE_RANGE.all,
        };
        const { shapes: all, coverShapes: shaped } = scene.current;
        for (let i = Math.max(0, from); i < Math.min(items.length, to); i++) {
          // The size it will be drawn at: its cover's footprint once that's known.
          const aspect = shaped ? (art.current?.aspect(paints[i].coverUrl) ?? null) : null;
          spineLabel(paints[i], kit, false, aspect === null ? all[i] : { ...all[i], ...coverFootprint(aspect) });
        }
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
