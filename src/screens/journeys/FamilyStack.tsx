import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useDataQuery, type Book, type DataStore, type Reader, type ReadSummary } from '../../data';
import { currentTimeZone, onTimeZoneChange } from '../../lib/timezone';
import CanvasStack from '../../staircase/CanvasStack';
import { stackItems, stackListText, stackMarkers, type StackItem } from '../../staircase/stackItems';
import { fmt, strings } from '../../strings';
import { BackToHub } from '../BackToHub';
import './familyStack.css';

/**
 * #/staircase — the Family Staircase: every book anyone in the household has read (each reader's
 * first confirmed read of it) is a book on one pile, newest on top. The screen opens on the newest
 * book; scrolling down goes back in time, past a dashed line where each month starts and flags at
 * book numbers 1, 10, 50, 100 and every 100. The bar at the bottom names the book in the middle.
 *
 * Counting is the same as the old staircase (#/staircase/old, from developer tools): the read
 * summaries in staircaseOrder. The pile follows new reads as they happen (useDataQuery).
 * Screen readers get the whole pile as a list, newest first. Loaded on its own (App.tsx).
 */

const t = strings.staircase;
const locale = strings.app.locale;

interface StackData {
  readers: Reader[];
  summaries: ReadSummary[];
  books: Map<string, Book>;
}

async function loadStack(store: DataStore, householdId: string): Promise<StackData> {
  const [readers, summaries] = await Promise.all([store.listReaders(householdId), store.listHouseholdReadSummaries(householdId)]);
  const books = await store.getBooks([...new Set(summaries.map((s) => s.isbn))]);
  return { readers, summaries, books: new Map(books.map((b) => [b.isbn, b])) };
}

export default function FamilyStack({ reader }: { reader: Reader }) {
  const query = useCallback((s: DataStore) => loadStack(s, reader.household_id), [reader.household_id]);
  const { data, loading } = useDataQuery(query, ['readers', 'read_events', 'books']);
  const zone = useSyncExternalStore(onTimeZoneChange, currentTimeZone, currentTimeZone);

  const items = useMemo(
    () =>
      data
        ? stackItems(data.summaries, data.readers, (isbn) => data.books.get(isbn)?.title, { title: t.stackUntitled, avatar: t.stackNoAvatar })
        : [],
    [data],
  );
  const markers = useMemo(() => stackMarkers(items, zone, { locale, first: t.stackFlagFirst, number: t.stackFlagNumber }), [items, zone]);
  const names = useMemo(() => new Map((data?.readers ?? []).map((r) => [r.id, r.display_name])), [data]);
  const count = items.length;

  // The bar under the pile names the book in the middle. It's written straight into the page
  // (no re-render while scrolling); the latest book is kept so the bar can catch up once mounted.
  const centre = useRef<StackItem | null>(null);
  const barAvatar = useRef<HTMLSpanElement | null>(null);
  const barTitle = useRef<HTMLSpanElement | null>(null);
  const paintBar = useCallback(() => {
    const item = centre.current;
    if (barAvatar.current) barAvatar.current.textContent = item?.avatar ?? '';
    if (barTitle.current) barTitle.current.textContent = item?.title ?? '';
  }, []);
  const onCentre = useCallback(
    (item: StackItem) => {
      centre.current = item;
      paintBar();
    },
    [paintBar],
  );
  useLayoutEffect(paintBar);

  const label = count === 1 ? t.stackLabelOne : fmt(t.stackLabel, { count: count.toLocaleString(locale) });

  return (
    <main className="page--kid family-stack">
      <header className="family-stack__header">
        <BackToHub />
        <h1 className="family-stack__title">
          <span>{t.title}</span>
          {count > 0 && (
            <span className="family-stack__total">{count === 1 ? t.stackTotalOne : fmt(t.stackTotal, { count: count.toLocaleString(locale) })}</span>
          )}
        </h1>
      </header>

      {loading || !data ? (
        <p className="muted family-stack__message">{strings.common.loading}</p>
      ) : count === 0 ? (
        <div className="empty-state family-stack__empty">
          <p className="kid-emoji" aria-hidden="true">
            📚
          </p>
          <p className="kid-lead">{t.stackEmpty}</p>
        </div>
      ) : (
        <>
          <CanvasStack items={items} markers={markers} seed={reader.household_id} label={label} onCentre={onCentre} />
          <p className="family-stack__bar" aria-hidden="true">
            <span ref={barAvatar} className="family-stack__bar-avatar" />
            <span ref={barTitle} className="family-stack__bar-title" />
          </p>
          <ol className="visually-hidden" aria-label={t.stackListLabel}>
            {[...items].reverse().map((item) => (
              <li key={item.key}>{stackListText(item, names.get(item.readerId) ?? t.someone, zone, { locale, template: t.stackListItem })}</li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
