import { useId, useState } from 'react';
import type { BookKey } from '../data';
import { isSearching } from '../lib/search';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { pickSummary, shownCandidates, type PickCandidate } from './pick';

const t = strings.collections;

interface BookPickerProps {
  /** The books to offer (null while loading). */
  candidates: readonly PickCandidate[] | null;
  /** The ticked books, in the order they were ticked. */
  picked: readonly BookKey[];
  onToggle: (isbn: BookKey) => void;
  /** Show each ticked book's number (its place in the tick order). */
  numbered: boolean;
  /** Search text to start with (tests). */
  initialSearch?: string;
}

/**
 * Several books ticked at once for a set (New collection): the household's books at Home or ever
 * borrowed, searchable, at most PICK_ROWS_SHOWN rows ("keep typing" past that). Each row says if
 * the book is borrowed or would move from another set; ticked books show their number.
 */
export function BookPicker({ candidates, picked, onToggle, numbered, initialSearch = '' }: BookPickerProps) {
  const [search, setSearch] = useState(initialSearch);
  const searchId = useId();
  if (candidates === null) return <p className="small muted">{strings.common.loading}</p>;
  if (candidates.length === 0) return <p className="muted">{t.pickNone}</p>;

  const { rows, matched } = shownCandidates(candidates, search);
  const summary = pickSummary(picked, candidates);
  return (
    <div className="stack">
      <label htmlFor={searchId} className="visually-hidden">
        {t.existingSearch}
      </label>
      <input
        id={searchId}
        className="input"
        type="search"
        autoComplete="off"
        placeholder={`🔎 ${t.existingSearch}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="small" aria-live="polite">
        {fmt(t.pickSelected, { count: summary.count })}
      </p>
      {summary.borrowed > 0 && <p className="small alert">{t.pickBorrowedNote}</p>}
      {matched === 0 && isSearching(search) && <p className="small muted">{fmt(t.pickNoMatch, { query: search.trim() })}</p>}
      <ul className="gu-list gu-pick-list">
        {rows.map((c) => {
          const order = picked.indexOf(c.book.isbn);
          return (
            <li key={c.book.isbn}>
              <PickRow candidate={c} order={order >= 0 ? order + 1 : null} numbered={numbered} onToggle={() => onToggle(c.book.isbn)} />
            </li>
          );
        })}
      </ul>
      {matched > rows.length && <p className="small muted">{fmt(t.pickMore, { shown: rows.length, count: matched })}</p>}
    </div>
  );
}

/** One tick row: the tick, cover, title and author, Borrowed / "moves from …", and its number once ticked. */
function PickRow({ candidate, order, numbered, onToggle }: { candidate: PickCandidate; order: number | null; numbered: boolean; onToggle: () => void }) {
  const { book, atHome, fromSet } = candidate;
  const id = useId();
  const tagged = !atHome || fromSet !== null;
  return (
    <label className="gu-row gu-pick">
      <input
        type="checkbox"
        className="gu-pick__tick"
        checked={order !== null}
        onChange={onToggle}
        aria-labelledby={`${id}-title`}
        aria-describedby={tagged ? `${id}-tags` : undefined}
      />
      <BookCover title={book.title} coverUrl={book.cover_url} seed={book.isbn} fit="row" />
      <span className="gu-row__body stack gu-pick__body">
        <span id={`${id}-title`} className="gu-row__title">
          {book.title}
        </span>
        {book.authors.length > 0 && <span className="small muted gu-row__sub">{book.authors.join(', ')}</span>}
        {tagged && (
          <span id={`${id}-tags`} className="row gu-pick__tags">
            {!atHome && <span className="chip-tag">{t.borrowedTag}</span>}
            {fromSet && <span className="chip-tag chip-tag--warn">{fmt(t.movesFrom, { title: fromSet.title })}</span>}
          </span>
        )}
      </span>
      {order !== null && numbered ? (
        <span className="set-sheet__number" aria-label={fmt(t.volume, { volume: order })}>
          {order}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
    </label>
  );
}
