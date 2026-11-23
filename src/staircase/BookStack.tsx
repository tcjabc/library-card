import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  LITE_ROW,
  TILT_SCALE,
  TILT_X_DEG,
  TILT_Y_DEG,
  bookShape,
  layoutWindow,
  stackLayout,
  visibleWindow,
  type BookShape,
  type StackEntry,
} from './stackModel';
import './bookStack.css';

/**
 * The Family Staircase as a pile of books, in CSS 3D (stage 1 prototype, loaded only by the
 * developer tools). Newest book on top; scroll down to go down the pile. Only the books on
 * screen (plus a few each way) are in the page: a sized spacer gives the scroll height, and
 * one tilted container holds the visible books, moved as the window changes.
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

/** Room above the newest book (its top shows above its spine) and below the oldest (px). */
const PAD_TOP = 112;
const PAD_BOTTOM = 160;
/** Books kept in the page above and below the visible ones. */
const BUFFER = 3;
/** Lite: the gap between flat spines (px). */
const LITE_GAP = 4;

interface Range {
  start: number;
  end: number;
}

export default function BookStack({ entries, seed, lite = false, label, onScroller, onScroll }: BookStackProps) {
  const count = entries.length;
  const shapes = useMemo(() => entries.map((e) => bookShape(seed, e.step)), [entries, seed]);
  const layout = useMemo(() => stackLayout(shapes.map((s) => s.thickness)), [shapes]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });

  const measure = useCallback(() => {
    frame.current = 0;
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop - PAD_TOP;
    const next = lite
      ? visibleWindow(top, el.clientHeight, LITE_ROW, count, BUFFER)
      : layoutWindow(layout, top / TILT_SCALE, (top + el.clientHeight) / TILT_SCALE, BUFFER);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
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
    };
  }, [measure]);

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
  const books = [];
  for (let i = range.start; i < range.end; i++) {
    const index = count - 1 - i; // list index 0 = the newest entry
    books.push({ entry: entries[index], shape: shapes[index], top: lite ? i * LITE_ROW : layout.tops[i] });
  }
  // Oldest of the window first, so a newer book paints over the one under it.
  books.reverse();
  const origin = lite ? 0 : (layout.tops[range.start] ?? 0);

  return (
    <div ref={setScroller} className="book-stack" role="region" aria-label={label} tabIndex={0} onScroll={handleScroll}>
      <div className="book-stack__sizer" style={{ height: spacer }}>
        {lite ? (
          <div className="book-stack__flat" style={{ top: PAD_TOP }}>
            {books.map(({ entry, shape, top }) => (
              <FlatBook key={entry.step} entry={entry} shape={shape} top={top} />
            ))}
          </div>
        ) : (
          <div
            className="book-stack__pile"
            style={
              {
                top: PAD_TOP + origin * TILT_SCALE,
                '--tilt-x': `${TILT_X_DEG}deg`,
                '--tilt-y': `${TILT_Y_DEG}deg`,
              } as CSSProperties
            }
          >
            {books.map(({ entry, shape, top }) => (
              <Book key={entry.step} entry={entry} shape={shape} top={top - origin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function colours(entry: StackEntry): CSSProperties {
  return { '--spine-hue': entry.spineHue, '--reader-hue': entry.readerHue } as CSSProperties;
}

function Spine({ entry }: { entry: StackEntry }) {
  return (
    <>
      <span className="book-stack__band" />
      <span className="book-stack__avatar" aria-hidden="true">
        {entry.avatar}
      </span>
      <span className="book-stack__title">{entry.title}</span>
    </>
  );
}

/** A box: the spine facing us, the cover on top and page edges on the two short sides. */
function Book({ entry, shape, top }: { entry: StackEntry; shape: BookShape; top: number }) {
  const { width: w, depth: d, thickness: t } = shape;
  return (
    <div
      className="book-stack__book"
      style={{
        ...colours(entry),
        top,
        width: w,
        height: t,
        marginLeft: -w / 2,
        transform: `translate3d(${shape.x}px, 0, ${shape.z}px) rotateY(${shape.yaw}deg)`,
      }}
    >
      <div className="book-stack__face book-stack__spine" style={{ transform: `translateZ(${d / 2}px)` }}>
        <Spine entry={entry} />
      </div>
      <div
        className="book-stack__face book-stack__cover"
        style={{ width: w, height: d, top: (t - d) / 2, transform: `rotateX(90deg) translateZ(${t / 2}px)` }}
      />
      <div
        className="book-stack__face book-stack__pages"
        style={{ width: d, height: t, left: (w - d) / 2, transform: `rotateY(90deg) translateZ(${w / 2}px)` }}
      />
      <div
        className="book-stack__face book-stack__pages"
        style={{ width: d, height: t, left: (w - d) / 2, transform: `rotateY(-90deg) translateZ(${w / 2}px)` }}
      />
    </div>
  );
}

/** Lite: the same spine, flat, in rows of one height. */
function FlatBook({ entry, shape, top }: { entry: StackEntry; shape: BookShape; top: number }) {
  return (
    <div
      className="book-stack__spine book-stack__flat-book"
      style={{
        ...colours(entry),
        top,
        width: shape.width,
        height: LITE_ROW - LITE_GAP,
        marginLeft: -shape.width / 2,
        transform: `translateX(${shape.x}px)`,
      }}
    >
      <Spine entry={entry} />
    </div>
  );
}
