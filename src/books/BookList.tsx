import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { everything, firstRows, sameRange, VIRTUALISE_OVER, windowRange, type WindowRange } from './listWindow';
import { ReadButton } from './ReadButton';

/** A row's height before it has been measured (px): a little over --list-row-min. */
const ROW_ESTIMATE = 96;

interface BookListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  label?: string;
  /** Another look for the list (default: the kids' rows). */
  className?: string;
}

/**
 * The List view of My Bookshelf and Library Books: one row per book. Over VIRTUALISE_OVER rows,
 * only the rows near the screen are on the page.
 */
export function BookList<T>({ items, keyOf, renderRow, label, className = 'book-list' }: BookListProps<T>) {
  const list = useRef<HTMLUListElement>(null);
  const keys = items.map(keyOf);
  const range = useListWindow(list, keys);
  const end = Math.min(range.end, items.length);
  const start = Math.min(range.start, end);
  const padded = range.padTop > 0 || range.padBottom > 0;

  return (
    <ul ref={list} className={className} aria-label={label} style={padded ? { paddingTop: range.padTop, paddingBottom: range.padBottom } : undefined}>
      {items.slice(start, end).map((item, i) => (
        <li key={keys[start + i]} className="book-list__item" data-row-key={keys[start + i]}>
          {renderRow(item)}
        </li>
      ))}
    </ul>
  );
}

function useListWindow(list: RefObject<HTMLUListElement | null>, keys: readonly string[]): WindowRange {
  const big = keys.length > VIRTUALISE_OVER;
  const [range, setRange] = useState<WindowRange | null>(null);
  const heights = useRef(new Map<string, number>());
  const latestKeys = useRef(keys);
  const schedule = useRef<() => void>(() => {});
  useEffect(() => {
    latestKeys.current = keys;
  });

  useEffect(() => {
    const el = list.current;
    if (!big || !el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      // The rows on the page now: their real heights.
      for (const child of Array.from(el.children)) {
        const key = (child as HTMLElement).dataset.rowKey;
        const height = child.getBoundingClientRect().height;
        if (key && height > 0) heights.current.set(key, height + gap);
      }
      const known = [...heights.current.values()];
      const guess = known.length ? known.reduce((a, b) => a + b, 0) / known.length : ROW_ESTIMATE + gap;
      const next = windowRange(
        latestKeys.current.map((k) => heights.current.get(k) ?? guess),
        -el.getBoundingClientRect().top,
        window.innerHeight,
      );
      setRange((prev) => (prev && sameRange(prev, next) ? prev : next));
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule.current = later;
    later();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    const observer = new ResizeObserver(later);
    observer.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      schedule.current = () => {};
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      observer.disconnect();
    };
  }, [big, list]);

  // After every render (other rows on the page, a filtered list): measure again.
  useEffect(() => {
    schedule.current();
  });

  if (!big) return everything(keys.length);
  return range ?? firstRows(keys.length);
}

interface BookRowProps {
  isbn: string;
  title: string;
  authors: readonly string[];
  coverUrl: string | null;
  /** The active reader's confirmed reads. */
  count: number;
  waiting: boolean;
  busy: boolean;
  onRead: (click: MouseEvent<HTMLButtonElement>) => void;
  /** More about the book, after the read state: a loan's due chip and borrower. */
  info?: ReactNode;
  /** Small buttons beside the read button: a loan's Renewed / Returned (icons, so the row stays short). */
  actions?: ReactNode;
  /** A returned library book (dimmed a little). */
  returned?: boolean;
}

/** One List row: a small whole cover, the title (two lines at most) and author, the read state (✓ ×N, ⏳) and the read button. */
export function BookRow({ isbn, title, authors, coverUrl, count, waiting, busy, onRead, info, actions, returned = false }: BookRowProps) {
  const t = strings.shelf;
  return (
    <div className={`book-row${returned ? ' book-row--returned' : ''}`}>
      <div className="book-row__cover">
        <BookCover title={title} coverUrl={coverUrl} seed={isbn} fit="row" />
      </div>
      <div className="book-row__info">
        <p className="book-row__title">{title}</p>
        {authors.length > 0 && <p className="book-row__author">{authors.join(', ')}</p>}
        {(count > 0 || waiting || info) && (
          <div className="book-row__state">
            {count > 0 && (
              <span className="read-state" role="img" aria-label={count > 1 ? fmt(t.readCount, { count }) : t.readStateLabel}>
                {t.readTick}
                {count > 1 && ` ${fmt(t.readTimes, { count })}`}
              </span>
            )}
            {waiting && (
              <span className="read-state read-state--waiting" role="img" aria-label={strings.reads.waiting}>
                ⏳
              </span>
            )}
            {info}
          </div>
        )}
      </div>
      <div className="book-row__read">
        <ReadButton title={title} count={count} disabled={busy} waiting={waiting} onRead={onRead} />
        {actions}
      </div>
    </div>
  );
}
