import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { countBookRender } from './bookRenders';
import { bookViews, type BookViews } from './bookViews';
import {
  LITE_ROW,
  STACK_BUFFER,
  STACK_PAD_BOTTOM,
  STACK_PAD_TOP,
  TILT_SCALE,
  TILT_X_DEG,
  TILT_Y_DEG,
  bookShape,
  layoutWindow,
  liteBuffer,
  sameWindow,
  stackLayout,
  visibleWindow,
  type StackEntry,
  type StackWindow,
} from './stackModel';
import './bookStack.css';

/**
 * The Family Staircase as a pile of books, in CSS 3D (stage 1 prototype, loaded only by the
 * developer tools). Newest book on top; scroll down to go down the pile. Only the books on
 * screen (plus a few each way) are in the page: a sized spacer gives the scroll height, and
 * one tilted container holds the visible books at their places in the whole pile.
 *
 * Scrolling re-renders only books coming into or leaving the window: each book is memoised
 * with stable props (its step and the pile's style lookup), and the window state changes only
 * when its first or last book does.
 */

export interface BookStackProps {
  /** Oldest first. */
  entries: readonly StackEntry[];
  /** Seeds each book's size and wobble (the household id, later). */
  seed: string;
  /** Flat 2D spines, no 3D: to compare. */
  lite?: boolean;
  /** The scroll area's name. */
  label: string;
  /** The scroll area, for measuring. */
  onScroller?: (el: HTMLDivElement | null) => void;
  onScroll?: () => void;
}

const PAD_TOP = STACK_PAD_TOP;
const PAD_BOTTOM = STACK_PAD_BOTTOM;

const PILE_STYLE = {
  top: PAD_TOP,
  '--tilt-x': `${TILT_X_DEG}deg`,
  '--tilt-y': `${TILT_Y_DEG}deg`,
} as CSSProperties;
const FLAT_STYLE: CSSProperties = { top: PAD_TOP };

function BookStack({ entries, seed, lite = false, label, onScroller, onScroll }: BookStackProps) {
  const count = entries.length;
  const shapes = useMemo(() => entries.map((e) => bookShape(seed, e.step)), [entries, seed]);
  const layout = useMemo(() => stackLayout(shapes.map((s) => s.thickness)), [shapes]);
  const views = useMemo(() => bookViews(entries, shapes, layout), [entries, shapes, layout]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const [range, setRange] = useState<StackWindow>({ start: 0, end: 0 });

  const measure = useCallback(() => {
    frame.current = 0;
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop - PAD_TOP;
    const next = lite
      ? visibleWindow(top, el.clientHeight, LITE_ROW, count, liteBuffer(el.clientHeight))
      : layoutWindow(layout, top / TILT_SCALE, (top + el.clientHeight) / TILT_SCALE, STACK_BUFFER);
    setRange((prev) => (sameWindow(prev, next) ? prev : next));
  }, [count, layout, lite]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const resize = new ResizeObserver(() => measure());
    resize.observe(el);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [measure]);

  // At most one measure per frame, however many scroll events arrive.
  const handleScroll = () => {
    onScroll?.();
    if (!frame.current) frame.current = requestAnimationFrame(measure);
  };

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      onScroller?.(el);
    },
    [onScroller],
  );

  const spacer = PAD_TOP + PAD_BOTTOM + (lite ? count * LITE_ROW : layout.height * TILT_SCALE);
  // Window rows run newest first; paint the oldest of the window first, so a newer book
  // paints over the one under it. Row r is entries[count - 1 - r].
  const steps: number[] = [];
  for (let r = range.end - 1; r >= range.start; r--) steps.push(entries[count - 1 - r].step);

  return (
    <div ref={setScroller} className="book-stack" role="region" aria-label={label} tabIndex={0} onScroll={handleScroll}>
      <div className="book-stack__sizer" style={{ height: spacer }}>
        {lite ? (
          <div className="book-stack__flat" style={FLAT_STYLE}>
            {steps.map((step) => (
              <FlatBook key={step} step={step} views={views} />
            ))}
          </div>
        ) : (
          <div className="book-stack__pile" style={PILE_STYLE}>
            {steps.map((step) => (
              <Book key={step} step={step} views={views} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(BookStack);

interface BookProps {
  step: number;
  /** The pile's style lookup: the same object for the whole pile. */
  views: BookViews;
}

function Spine({ title, avatar }: { title: string; avatar: string }) {
  return (
    <>
      <span className="book-stack__band" />
      <span className="book-stack__avatar" aria-hidden="true">
        {avatar}
      </span>
      <span className="book-stack__title">{title}</span>
    </>
  );
}

/** A box as the camera sees it: the spine facing us, the cover on top and the page edges on the right. */
const Book = memo(function Book({ step, views }: BookProps) {
  countBookRender();
  const view = views.get(step);
  if (!view) return null;
  return (
    <div className="book-stack__book" style={view.book}>
      <div className="book-stack__face book-stack__spine" style={view.spine}>
        <Spine title={view.title} avatar={view.avatar} />
      </div>
      <div className="book-stack__face book-stack__cover" style={view.cover} />
      <div className="book-stack__face book-stack__pages" style={view.pages} />
    </div>
  );
});

/** Lite: the same spine, flat, in rows of one height. */
const FlatBook = memo(function FlatBook({ step, views }: BookProps) {
  countBookRender();
  const view = views.get(step);
  if (!view) return null;
  return (
    <div className="book-stack__spine book-stack__flat-book" style={view.flat}>
      <Spine title={view.title} avatar={view.avatar} />
    </div>
  );
});
