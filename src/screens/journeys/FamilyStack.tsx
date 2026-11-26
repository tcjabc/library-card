import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDataQuery, type Book, type Collection, type DataStore, type Library, type Loan, type Reader, type ReadSummary } from '../../data';
import { useBookDetails } from '../../books/useBookDetails';
import { useToday } from '../../lib/clock';
import { currentTimeZone, onTimeZoneChange } from '../../lib/timezone';
import { familyPart } from '../../staircase/bookFamily';
import { cssLength } from '../../staircase/canvasHelpers';
import CanvasStack, { type StackDrop } from '../../staircase/CanvasStack';
import { thud, vibrationMs } from '../../staircase/dropMotion';
import { playThud, vibrateLanding } from '../../staircase/dropSound';
import { useStackCovers } from '../../staircase/coverSetting';
import { useStackGap } from '../../staircase/gapSetting';
import { BIGGEST_SHAPED_BOOK } from '../../staircase/bookShapes';
import { useStackShapes } from '../../staircase/shapeSetting';
import { useStackSky } from '../../staircase/skySetting';
import { useStackGround } from '../../staircase/groundSetting';
import { useStackClouds } from '../../staircase/cloudsSetting';
import { useStackForeground } from '../../staircase/foregroundSetting';
import { useStackDecor } from '../../staircase/decorSetting';
import { useStackSlow } from '../../staircase/slowSetting';
import { useStackSounds, writeStackSounds } from '../../staircase/soundSetting';
import { SeenTracker, arrival, parseSeen, seenKey, type Arrival, type Seen } from '../../staircase/stackSeen';
import { isExpanded, sheetBook, sheetHeights, type SheetHeights, type SheetState } from '../../staircase/sheetState';
import { stackItems, stackListText, stackMarkers, type StackItem } from '../../staircase/stackItems';
import { BIGGEST_BOOK } from '../../staircase/stackModel';
import { eyeLineReach } from '../../staircase/stackProjection';
import { fmt, strings } from '../../strings';
import { BackToHub } from '../BackToHub';
import { BookDetailsSheet, BookSheetContent } from './BookDetailsSheet';
import './familyStack.css';

/**
 * #/staircase — the Family Staircase: every book anyone in the household has read (each reader's
 * first confirmed read of it) is a book on one pile, newest on top. The screen opens on the newest
 * book; scrolling down goes back in time, past a dashed line where each month starts and flags at
 * book numbers 1, 10, 50, 100 and every 100. The bar at the bottom names the book in the middle,
 * and opens into a sheet about it (BookDetailsSheet.tsx): the family's own data first, then the
 * web's details. The sheet lies over the pile, so the pile never changes size.
 *
 * New books since the reader's last visit on this device (stackSeen.ts) fall onto the pile when
 * it opens (dropMotion.ts), with a thud and a tiny vibration unless "Stack sounds" is off (the
 * 🔊 button in the header, or Grown-ups → Settings); with reduced motion they're highlighted.
 *
 * Counting is the same as the old staircase (#/staircase/old, from developer tools): the read
 * summaries in staircaseOrder. The pile follows new reads as they happen (useDataQuery).
 * Screen readers get the whole pile as a list, newest first. Loaded on its own (App.tsx).
 */

const t = strings.staircase;
const locale = strings.app.locale;

/** The "new books" announcement waits this long after the screen opens, so screen readers hear it (ms). */
const ANNOUNCE_AFTER_MS = 600;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This reader's stored count on this device (null: their first visit here, or no storage). */
function readSeen(readerId: string): Seen {
  try {
    return parseSeen(storage()?.getItem(seenKey(readerId)) ?? null);
  } catch {
    return null;
  }
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A landing: its thud and vibration (each checks "Stack sounds" and that the page is visible). */
function landed({ mass, impulse }: { mass: number; impulse: number }): void {
  playThud(thud(mass, impulse));
  vibrateLanding(vibrationMs(impulse));
}

/** While the half-open sheet follows the pile, a book is looked up once it has been at the eye line this long (ms). */
const LOOKUP_SETTLE_MS = 350;

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

/** What the book sheet's family part needs besides the pile: loans out now, libraries, collections, the home shelf. */
interface SheetData {
  loans: Loan[];
  libraries: Library[];
  collections: Collection[];
  homeIsbns: Set<string>;
}

async function loadSheetData(store: DataStore, householdId: string): Promise<SheetData> {
  const [loans, libraries, collections, home] = await Promise.all([
    store.listLoans(householdId, { active: true }),
    store.listLibraries(householdId),
    store.listCollections(householdId),
    store.listHomeItems(householdId),
  ]);
  return { loans, libraries, collections, homeIsbns: new Set(home.map((h) => h.isbn)) };
}

export default function FamilyStack({ reader }: { reader: Reader }) {
  const query = useCallback((s: DataStore) => loadStack(s, reader.household_id), [reader.household_id]);
  const { data, loading } = useDataQuery(query, ['readers', 'read_events', 'books']);
  const sheetQuery = useCallback((s: DataStore) => loadSheetData(s, reader.household_id), [reader.household_id]);
  const { data: sheetData } = useDataQuery(sheetQuery, ['loans', 'libraries', 'collections', 'home_items']);
  const zone = useSyncExternalStore(onTimeZoneChange, currentTimeZone, currentTimeZone);
  const today = useToday();
  const covers = useStackCovers();
  const gap = useStackGap();
  const coverShapes = useStackShapes();
  const sky = useStackSky();
  const ground = useStackGround();
  const clouds = useStackClouds();
  const foreground = useStackForeground();
  const decor = useStackDecor();
  const pretendSlow = useStackSlow();
  const sounds = useStackSounds();

  const items = useMemo(
    () =>
      data
        ? stackItems(
            data.summaries,
            data.readers,
            (isbn) => data.books.get(isbn)?.title,
            { title: t.stackUntitled, avatar: t.stackNoAvatar },
            (isbn) => data.books.get(isbn)?.cover_url,
          )
        : [],
    [data],
  );
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const markers = useMemo(() => stackMarkers(items, zone, { locale, first: t.stackFlagFirst, number: t.stackFlagNumber }), [items, zone]);
  const names = useMemo(() => new Map((data?.readers ?? []).map((r) => [r.id, r.display_name])), [data]);
  const count = items.length;

  // Since the last visit: decided once, when the pile first loads (reading only; the count is
  // written in effects). Books that fall start the pile where it was without them.
  const tracker = useMemo(() => new SeenTracker(storage(), reader.id), [reader.id]);
  const [greeted, setGreeted] = useState<{ arrival: Arrival; drop: StackDrop | null } | null>(null);
  if (data && !greeted) {
    const a = arrival(count, readSeen(reader.id), reducedMotion());
    setGreeted({ arrival: a, drop: a.count > 0 ? { id: 1, count: a.count, kind: a.kind === 'drop' ? 'fall' : 'highlight' } : null });
  }
  const total = useRef(count);
  useLayoutEffect(() => {
    total.current = count;
  }, [count]);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!greeted) return;
    // Nothing to drop (first visit, nothing new) or a highlight: the reader has seen the pile now.
    if (greeted.arrival.kind !== 'drop') tracker.record(total.current);
    const n = greeted.arrival.count;
    if (n <= 0) return;
    const timer = window.setTimeout(() => setAnnounce(n === 1 ? t.stackNewOne : fmt(t.stackNewMany, { count: n.toLocaleString(locale) })), ANNOUNCE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [greeted, tracker]);
  // Leaving the screen or hiding the app: the pile as it is now has been seen (so an interrupted
  // drop doesn't replay everything next time).
  const loaded = !!data;
  useEffect(() => {
    if (!loaded) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') tracker.record(total.current);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      tracker.record(total.current);
    };
  }, [loaded, tracker]);
  const onDropEnd = useCallback(() => tracker.record(total.current), [tracker]);

  // The book sheet: collapsed (the bar), half or full. While half open it follows the book at
  // the eye line; full keeps the book it had (the pile is covered and not drawn).
  const [sheet, setSheet] = useState<SheetState>('collapsed');
  const sheetNow = useRef<SheetState>('collapsed');
  const [shownKey, setShownKey] = useState<string | null>(null);

  // The bar names the book in the middle. It's written straight into the page (no re-render
  // while scrolling); the latest book is kept so the bar can catch up once mounted.
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
      if (isExpanded(sheetNow.current)) setShownKey((held) => sheetBook(sheetNow.current, item.key, held));
    },
    [paintBar],
  );
  useLayoutEffect(paintBar);

  const changeSheet = useCallback((next: SheetState) => {
    if (!isExpanded(sheetNow.current) && isExpanded(next)) setShownKey(centre.current?.key ?? null);
    sheetNow.current = next;
    setSheet(next);
  }, []);

  const expanded = isExpanded(sheet);
  const shown = expanded && shownKey ? (byKey.get(shownKey) ?? null) : null;

  // The web lookup waits until the half-open sheet has stayed on a book for a moment (not for
  // every book scrolling past); the first book it opens on is looked up straight away.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!expanded) {
      openedOn.current = null;
      return;
    }
    const key = shown?.key ?? null;
    const first = openedOn.current === null;
    if (first) openedOn.current = key;
    const timer = window.setTimeout(() => setSettledKey(key), first ? 0 : LOOKUP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, shown?.key]);
  const { status, retry } = useBookDetails(shown?.isbn ?? null, expanded && !!shown && settledKey === shown.key);

  const family = useMemo(
    () =>
      shown && data
        ? familyPart({
            item: shown,
            summaries: data.summaries,
            readers: data.readers,
            loans: sheetData?.loans ?? [],
            libraries: sheetData?.libraries ?? [],
            homeIsbns: sheetData?.homeIsbns ?? new Set(),
            book: data.books.get(shown.isbn),
            collections: sheetData?.collections ?? [],
            someone: { name: t.someone, avatar: t.stackNoAvatar },
          })
        : null,
    [shown, data, sheetData],
  );

  // How tall the sheet is in each state, from the page, the pile and the bar's place. The half
  // state stops just below the book at the eye line.
  const page = useRef<HTMLElement | null>(null);
  const dock = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<SheetHeights | null>(null);
  useLayoutEffect(() => {
    const p = page.current;
    const d = dock.current;
    if (!p || !d || !scroller) return;
    const measure = () => {
      const css = getComputedStyle(document.documentElement);
      const rem = parseFloat(css.fontSize) || 16;
      const length = (name: string) => cssLength(css.getPropertyValue(name), rem) || 0;
      const pageTop = p.getBoundingClientRect().top;
      const next = sheetHeights({
        page: p.clientHeight,
        headerBottom: scroller.getBoundingClientRect().top - pageTop,
        view: scroller.clientHeight,
        bar: d.offsetHeight,
        reach: eyeLineReach(coverShapes ? BIGGEST_SHAPED_BOOK : BIGGEST_BOOK, length('--space-3')),
        minHalf: length('--stack-sheet-min-half'),
      });
      setHeights((prev) => (prev && prev.collapsed === next.collapsed && prev.half === next.half && prev.full === next.full ? prev : next));
    };
    // A ResizeObserver reports once straight away, then on every resize or turn.
    const resize = new ResizeObserver(measure);
    resize.observe(p);
    resize.observe(scroller);
    resize.observe(d);
    return () => resize.disconnect();
  }, [scroller, coverShapes]);

  const label = count === 1 ? t.stackLabelOne : fmt(t.stackLabel, { count: count.toLocaleString(locale) });

  return (
    <main ref={page} className="page--kid family-stack">
      <header className="family-stack__header">
        <BackToHub />
        <h1 className="family-stack__title">
          <span>{t.title}</span>
          {count > 0 && (
            <span className="family-stack__total">{count === 1 ? t.stackTotalOne : fmt(t.stackTotal, { count: count.toLocaleString(locale) })}</span>
          )}
        </h1>
        <button
          type="button"
          className="btn btn--quiet family-stack__sound"
          aria-pressed={sounds}
          aria-label={t.stackSounds}
          title={sounds ? t.stackSoundsOnHint : t.stackSoundsOffHint}
          onClick={() => writeStackSounds(!sounds)}
        >
          <span aria-hidden="true">{sounds ? '🔊' : '🔇'}</span>
        </button>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>

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
          <CanvasStack
            items={items}
            markers={markers}
            seed={reader.household_id}
            label={label}
            onCentre={onCentre}
            onScroller={setScroller}
            paused={sheet === 'full'}
            covers={covers}
            reportCovers
            coverShapes={coverShapes}
            gap={gap}
            sky={sky}
            ground={ground}
            clouds={clouds}
            foreground={foreground}
            decor={decor}
            pretendSlow={pretendSlow}
            drop={greeted?.drop ?? null}
            liveDrops
            onLanding={landed}
            onDropEnd={onDropEnd}
          />
          <div ref={dock} className="family-stack__dock" aria-hidden="true" />
          <BookDetailsSheet
            state={sheet}
            heights={heights}
            onChange={changeSheet}
            barAvatar={barAvatar}
            barTitle={barTitle}
            label={fmt(t.sheetLabel, { title: shown?.title ?? '' })}
          >
            {shown && family && (
              <BookSheetContent
                key={shown.key}
                item={shown}
                book={data.books.get(shown.isbn)}
                family={family}
                status={status}
                retry={retry}
                zone={zone}
                today={today}
              />
            )}
          </BookDetailsSheet>
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
