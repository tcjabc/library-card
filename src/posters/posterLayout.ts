import type { JourneyDirection } from '../journeys/journeys';

/**
 * Printable journey posters (Grown-ups > Cards > Journey posters): the page and where each book's
 * slot goes. Pure numbers, in the poster's own units: an A4 portrait viewBox of 794 x 1123, printed
 * at 210 x 297 mm (1 unit = 0.2645 mm, the same both ways).
 *
 * The page, top to bottom: the label band (title, caption, the name line and the finish or start
 * label, y <= 200), the art band (y 215-1012: the journey's line drawing in the middle column, the
 * numbered slots either side) and the bottom band (the other label and the footer, y >= 1030).
 * docs/posters.md has the picture and how to add a poster.
 */

/** Millimetres per poster unit on A4 (210 mm across 794 units). */
export const MM_PER_UNIT = 210 / 794;

export interface PosterFrame {
  width: number;
  height: number;
  /** The centre line (x) the art and the slots are placed round. */
  centre: number;
  /** The numbered circles sit this far either side of the centre line. */
  circleOffset: number;
  circleRadius: number;
  /** The art stays within this distance of the centre line. */
  artHalf: number;
  /** The art band, which the slots are spread over. */
  slotTop: number;
  slotBottom: number;
  /** A safe margin no printer clips: 9 mm. Nothing is drawn in it. */
  margin: number;
  /** Space between a circle and its writing line. */
  gap: number;
  /** How far inside the margin a writing line stops. */
  lineInset: number;
  /** A writing line sits this far below its circle's centre (a fraction of the radius). */
  lineDrop: number;
}

export const POSTER_FRAME: PosterFrame = {
  width: 794,
  height: 1123,
  centre: 397,
  circleOffset: 84,
  circleRadius: 18,
  artHalf: 66,
  slotTop: 215,
  slotBottom: 1012,
  margin: 9 / MM_PER_UNIT,
  gap: 8,
  lineInset: 6,
  lineDrop: 0.55,
};

/** Line weights, in poster units (2.5 = 0.66 mm, 2 = 0.53 mm, 1.2 = 0.32 mm). */
export const POSTER_STROKES = {
  art: 2.5,
  circle: 2,
  line: 1.2,
  /** The art's dotted trails: dot length and gap. */
  dots: '2 12',
} as const;

/** Text sizes and baselines, in poster units. The bands they sit in are above. */
export const POSTER_TYPE = {
  titleSize: 40,
  titleY: 82,
  captionSize: 18,
  captionY: 116,
  nameSize: 20,
  nameY: 162,
  /** Where the name line starts, clear of "My name". */
  nameLineX: 150,
  /** START / FINISH: the top one's baseline is just above the art band, the bottom one's just below. */
  endSize: 22,
  endTopY: 200,
  endBottomY: 1054,
  footerSize: 15,
  footerY: 1080,
  /** A slot's number, as a fraction of the circle's radius (size, and baseline below the centre). */
  numberSize: 1.05,
  numberDrop: 0.37,
} as const;

export type PosterSide = 'left' | 'right';

export interface PosterSlot {
  /** 1 = the first book read. */
  book: number;
  side: PosterSide;
  cx: number;
  cy: number;
  r: number;
  /** The writing line: from the margin side (x1) to the circle side (x2) on the left, the other way round on the right; x1 < x2 always. */
  line: { x1: number; x2: number; y: number };
}

/**
 * Where each book's slot goes: book 1 at the start end (the bottom, or the top for a journey that
 * goes down), alternating left and right, evenly spread over the art band. Each writing line runs
 * from beside its circle out to the safe margin.
 */
export function layoutSlots(steps: number, direction: JourneyDirection, frame: PosterFrame = POSTER_FRAME): PosterSlot[] {
  const pitch = (frame.slotBottom - frame.slotTop) / steps;
  const r = frame.circleRadius;
  return Array.from({ length: steps }, (_, i) => {
    const fromStart = (i + 0.5) * pitch;
    const cy = direction === 'down' ? frame.slotTop + fromStart : frame.slotBottom - fromStart;
    const side: PosterSide = i % 2 === 0 ? 'left' : 'right';
    const cx = side === 'left' ? frame.centre - frame.circleOffset : frame.centre + frame.circleOffset;
    const inner = side === 'left' ? cx - r - frame.gap : cx + r + frame.gap;
    const outer = side === 'left' ? frame.margin + frame.lineInset : frame.width - frame.margin - frame.lineInset;
    return {
      book: i + 1,
      side,
      cx,
      cy,
      r,
      line: { x1: Math.min(inner, outer), x2: Math.max(inner, outer), y: cy + r * frame.lineDrop },
    };
  });
}
