import type { MouseEvent } from 'react';
import { ReadButton } from '../books/ReadButton';
import type { Book, Collection } from '../data';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { Sheet } from '../ui/Sheet';
import type { Progress, Slot } from './progress';
import { progressText, setCover } from './setDisplay';

const t = strings.collections;

interface SetCardProps {
  collection: Collection;
  slots: readonly Slot<Book>[];
  progress: Progress;
  onOpen: () => void;
}

/** A set on the shelf grid: one card (whole cover, title, progress), no read button of its own. */
export function SetCard({ collection, slots, progress, onOpen }: SetCardProps) {
  const label = fmt(t.openSet, { title: collection.title });
  return (
    <li className={`shelf-book set-card${progress.complete ? ' shelf-book--read' : ''}`}>
      <button type="button" className="set-card__open" aria-label={label} onClick={onOpen}>
        <span className="shelf-book__cover">
          <BookCover title={collection.title} coverUrl={setCover(collection, slots)} seed={collection.id} fit="whole" />
          <span className="set-badge" aria-hidden="true">
            {t.setBadge}
          </span>
        </span>
        <span className="shelf-book__title">{collection.title}</span>
      </button>
      <button
        type="button"
        className={`btn read-toggle set-toggle${progress.trophy ? ' set-toggle--trophy' : ''}`}
        aria-label={`${label}. ${progress.trophy ? t.trophy : fmt(t.progressLabel, { read: progress.read, total: progress.total })}`}
        onClick={onOpen}
      >
        {progressText(progress)}
      </button>
    </li>
  );
}

/** A set in the List: a row like a book's, with its progress where a read button would be. */
export function SetRow({ collection, slots, progress, onOpen }: SetCardProps) {
  const books = slots.filter((s) => s.books.length > 0).length;
  return (
    <div className="book-row set-row">
      <div className="book-row__cover">
        <BookCover title={collection.title} coverUrl={setCover(collection, slots)} seed={collection.id} fit="row" />
      </div>
      <div className="book-row__info">
        <p className="book-row__title">{collection.title}</p>
        <p className="book-row__author">
          <span className="set-badge set-badge--inline">{t.setBadge}</span> {books === 1 ? t.booksCountOne : fmt(t.booksCount, { count: books })}
        </p>
      </div>
      <div className="book-row__read">
        <button
          type="button"
          className={`btn read-toggle set-toggle${progress.trophy ? ' set-toggle--trophy' : ''}`}
          aria-label={fmt(t.openSet, { title: collection.title })}
          onClick={onOpen}
        >
          {progressText(progress)}
        </button>
      </div>
    </div>
  );
}

interface SetSheetProps {
  collection: Collection;
  slots: readonly Slot<Book>[];
  progress: Progress;
  /** Confirmed reads of each book by the active reader. */
  countOf: (isbn: string) => number;
  waiting: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onRead: (book: Book, click: MouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
}

/**
 * A set opened: its books in order, each with the normal read button and flow (By myself / With
 * help, the grown-up check, ⏳ waiting). A number not added yet shows as "not here yet"; a number
 * with several editions shows the first added, with "N editions".
 */
export function SetSheet({ collection, slots, progress, countOf, waiting, pending, onRead, onClose }: SetSheetProps) {
  return (
    <Sheet title={collection.title} onClose={onClose}>
      <p className={`set-sheet__progress${progress.trophy ? ' set-sheet__progress--trophy' : ''}`}>
        {progressText(progress)}
        {progress.locked && <span className="visually-hidden"> {t.locked}</span>}
      </p>
      <ul className="set-sheet">
        {slots.map((slot, i) => {
          const book = slot.books[0];
          const label = slot.volume === null ? t.unnumbered : fmt(t.volume, { volume: slot.volume });
          if (!book) {
            return (
              <li key={`empty-${slot.volume}`} className="set-sheet__slot set-sheet__slot--empty">
                <span className="set-sheet__number" aria-hidden="true">
                  {slot.volume}
                </span>
                <p className="muted">{fmt(t.notHereYet, { volume: slot.volume ?? '' })}</p>
              </li>
            );
          }
          // Any edition read counts for the number; a new read goes on the first added. A read waiting
          // for a grown-up only shows while the number isn't read yet.
          const count = slot.books.reduce((n, b) => n + countOf(b.isbn), 0);
          const isWaiting = waiting.has(book.isbn) || (count === 0 && slot.books.some((b) => waiting.has(b.isbn)));
          return (
            <li key={`${slot.volume ?? 'x'}-${book.isbn}-${i}`} className="set-sheet__slot">
              <div className="set-sheet__cover">
                <BookCover title={book.title} coverUrl={book.cover_url} seed={book.isbn} fit="row" />
                {slot.volume !== null && (
                  <span className="set-sheet__number" aria-hidden="true">
                    {slot.volume}
                  </span>
                )}
              </div>
              <div className="book-row__info">
                <p className="small muted">{label}</p>
                <p className="book-row__title">{book.title}</p>
                {slot.books.length > 1 && <span className="chip-tag">{fmt(t.editions, { count: slot.books.length })}</span>}
              </div>
              <div className="set-sheet__read">
                <ReadButton
                  title={book.title}
                  count={count}
                  disabled={pending.has(book.isbn)}
                  waiting={isWaiting}
                  onRead={(e) => onRead(book, e)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
