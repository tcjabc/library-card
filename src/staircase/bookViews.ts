/**
 * The book stack's per-book styles, worked out once per pile (pure, unit-tested). Each book's
 * colours, size, place and wobble don't change while scrolling, so the stack builds this lookup
 * once and each book component reads its own entry by step: its props stay the same between
 * renders and React can skip it.
 */
import type { CSSProperties } from 'react';
import { LITE_ROW, type BookShape, type StackEntry, type StackLayout } from './stackModel';

/** Lite: the gap between flat spines (px). */
export const LITE_GAP = 4;

export interface BookView {
  step: number;
  title: string;
  avatar: string;
  /** 3D: the book box (its place in the pile, size and wobble, plus its colours). */
  book: CSSProperties;
  spine: CSSProperties;
  cover: CSSProperties;
  /**
   * The page edges on the right-hand short side: the camera (turned TILT_Y_DEG) only ever sees
   * that one, so the left-hand side isn't drawn.
   */
  pages: CSSProperties;
  /** Lite: the flat spine in its row. */
  flat: CSSProperties;
}

export type BookViews = ReadonlyMap<number, BookView>;

/**
 * Every book's styles, by step. `entries` and `shapes` are oldest first (as the stack gets them);
 * `layout` is stackLayout of those shapes' thicknesses (newest first).
 */
export function bookViews(entries: readonly StackEntry[], shapes: readonly BookShape[], layout: StackLayout): BookViews {
  const views = new Map<number, BookView>();
  const count = entries.length;
  for (let index = 0; index < count; index++) {
    const entry = entries[index];
    const { width: w, depth: d, thickness: t, x, z, yaw } = shapes[index];
    const row = count - 1 - index; // 0 = the newest book, at the top of the pile
    const colours = { '--spine-hue': entry.spineHue, '--reader-hue': entry.readerHue } as CSSProperties;
    views.set(entry.step, {
      step: entry.step,
      title: entry.title,
      avatar: entry.avatar,
      book: {
        ...colours,
        top: layout.tops[row],
        width: w,
        height: t,
        marginLeft: -w / 2,
        transform: `translate3d(${x}px, 0, ${z}px) rotateY(${yaw}deg)`,
      },
      spine: { transform: `translateZ(${d / 2}px)` },
      cover: { width: w, height: d, top: (t - d) / 2, transform: `rotateX(90deg) translateZ(${t / 2}px)` },
      pages: { width: d, height: t, left: (w - d) / 2, transform: `rotateY(90deg) translateZ(${w / 2}px)` },
      flat: {
        ...colours,
        top: row * LITE_ROW,
        width: w,
        height: LITE_ROW - LITE_GAP,
        marginLeft: -w / 2,
        transform: `translateX(${x}px)`,
      },
    });
  }
  return views;
}
