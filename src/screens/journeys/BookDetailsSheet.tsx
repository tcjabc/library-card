import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { Book } from '../../data';
import type { BookDetails } from '../../books/details';
import type { DetailsStatus } from '../../books/useBookDetails';
import { DueChip } from '../../library/DueChip';
import type { FamilyPart, FamilyReader } from '../../staircase/bookFamily';
import { dragVisible, historyStep, isExpanded, nextSheetState, TAP_SLOP, type SheetEvent, type SheetHeights, type SheetState } from '../../staircase/sheetState';
import { readDate, type StackItem } from '../../staircase/stackItems';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import './bookDetailsSheet.css';

/**
 * The bar under the Family Staircase's pile, which opens into a sheet about the book at the eye
 * line (states and rules: src/staircase/sheetState.ts). Collapsed it is the bar as it always
 * was. A tap on the bar, or a drag up, opens it; a tap, a drag down, Escape or the browser's Back
 * closes it. It lies over the pile (the pile keeps its size), and the parent pauses the pile's
 * drawing while it's full.
 *
 * The bar is a button (aria-expanded); while open, the sheet's panel is a non-modal dialog that
 * takes the focus, and the focus goes back to the bar when it closes. The bar's avatar and title
 * are written by the parent straight into its spans, as the pile scrolls (no re-render).
 */

const t = strings.staircase;
const locale = strings.app.locale;

/** A click this soon after a drag ended (ms) is the drag's own. */
const CLICK_AFTER_DRAG_MS = 500;

/** How a change was asked for (Back is the only one that has already taken its history entry). */
export type SheetCause = SheetEvent['type'];

interface BookDetailsSheetProps {
  state: SheetState;
  /** null until the page has been measured. */
  heights: SheetHeights | null;
  onChange: (next: SheetState, cause: SheetCause) => void;
  barAvatar: RefObject<HTMLSpanElement | null>;
  barTitle: RefObject<HTMLSpanElement | null>;
  /** The open sheet's name ("About Moon Soup"). */
  label: string;
  children: ReactNode;
}

interface Drag {
  pointer: number;
  startY: number;
  startVisible: number;
  visible: number;
  moved: boolean;
  /** Recent (time, y) samples, for the speed at release. */
  samples: { t: number; y: number }[];
}

/** px/ms upwards over the last ~100 ms of the drag. */
function releaseSpeed(samples: readonly { t: number; y: number }[]): number {
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 100) ?? samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (first.y - last.y) / dt : 0;
}

export function BookDetailsSheet({ state, heights, onChange, barAvatar, barTitle, label, children }: BookDetailsSheetProps) {
  const panelId = useId();
  const sheet = useRef<HTMLElement | null>(null);
  const bar = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  /**
   * When a drag on the bar ended (ms, event time): a mouse drag's own click right after isn't a
   * tap. (A finger's drag has no click, so the next press clears it.)
   */
  const dragEndedAt = useRef<number | null>(null);
  const expanded = isExpanded(state);
  const [dragging, setDragging] = useState(false);

  const latest = useRef({ state, heights, onChange });
  useLayoutEffect(() => {
    latest.current = { state, heights, onChange };
  });
  const lastCause = useRef<SheetCause | null>(null);
  const change = useCallback((next: SheetState, cause: SheetCause) => {
    lastCause.current = cause;
    latest.current.onChange(next, cause);
  }, []);

  // The sheet's height for its state (also after a drag that comes back to the same state).
  useLayoutEffect(() => {
    const el = sheet.current;
    if (el && heights && !drag.current?.moved) el.style.height = `${heights[state]}px`;
  }, [state, heights]);

  // Opening and closing: the history entry Back closes it with, and where the focus goes.
  const previous = useRef<SheetState>(state);
  useEffect(() => {
    const prev = previous.current;
    previous.current = state;
    if (prev === state) return;
    const step = historyStep(prev, state, lastCause.current === 'back');
    if (step === 'push') window.history.pushState({ ...(window.history.state ?? {}), stackSheet: true }, '');
    else if (step === 'pop' && window.history.state?.stackSheet) window.history.back();
    if (!isExpanded(prev) && isExpanded(state)) panel.current?.focus({ preventScroll: true });
    if (isExpanded(prev) && !isExpanded(state)) {
      const active = document.activeElement;
      if (!active || active === document.body || sheet.current?.contains(active)) bar.current?.focus({ preventScroll: true });
    }
  }, [state]);

  // Back closes it; so does Escape, wherever the focus is.
  useEffect(() => {
    if (!expanded) return;
    const onPop = () => {
      if (!window.history.state?.stackSheet && isExpanded(latest.current.state)) change(nextSheetState(latest.current.state, { type: 'back' }), 'back');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      change(nextSheetState(latest.current.state, { type: 'escape' }), 'escape');
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded, change]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragEndedAt.current = null;
    if (event.button !== 0 || !heights || !sheet.current) return;
    const visible = sheet.current.getBoundingClientRect().height;
    drag.current = { pointer: event.pointerId, startY: event.clientY, startVisible: visible, visible, moved: false, samples: [{ t: event.timeStamp, y: event.clientY }] };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const h = latest.current.heights;
    if (!d || d.pointer !== event.pointerId || !h || !sheet.current) return;
    const dy = d.startY - event.clientY;
    if (!d.moved) {
      if (Math.abs(dy) < TAP_SLOP) return;
      d.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    d.samples.push({ t: event.timeStamp, y: event.clientY });
    if (d.samples.length > 12) d.samples.shift();
    d.visible = dragVisible(d.startVisible, dy, h);
    sheet.current.style.height = `${d.visible}px`;
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    dragEndedAt.current = event.timeStamp;
    setDragging(false);
    const h = latest.current.heights;
    if (!h) return;
    const next = nextSheetState(latest.current.state, { type: 'drag', visible: d.visible, velocity: cancelled ? 0 : releaseSpeed(d.samples), heights: h });
    if (sheet.current) sheet.current.style.height = `${h[next]}px`;
    if (next !== latest.current.state) change(next, 'drag');
  };
  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const ended = dragEndedAt.current;
    dragEndedAt.current = null;
    if (ended !== null && event.timeStamp - ended < CLICK_AFTER_DRAG_MS) return;
    change(nextSheetState(state, { type: 'tap' }), 'tap');
  };

  return (
    <section ref={sheet} className={`stack-sheet stack-sheet--${state}${dragging ? ' stack-sheet--dragging' : ''}`} hidden={!heights}>
      <button
        ref={bar}
        type="button"
        className="stack-sheet__bar"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        <span className="stack-sheet__handle" aria-hidden="true" />
        <span ref={barAvatar} className="stack-sheet__bar-avatar" aria-hidden="true" />
        <span ref={barTitle} className="stack-sheet__bar-title" />
        <span className="visually-hidden">{expanded ? t.sheetCloseHint : t.sheetOpenHint}</span>
      </button>
      <div
        ref={panel}
        id={panelId}
        className="stack-sheet__panel"
        role={expanded ? 'dialog' : undefined}
        aria-modal={expanded ? false : undefined}
        aria-label={expanded ? label : undefined}
        aria-hidden={expanded ? undefined : true}
        inert={!expanded}
        tabIndex={-1}
      >
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// What the sheet shows
// ---------------------------------------------------------------------------

function Reader({ reader }: { reader: FamilyReader }) {
  return (
    <span className="stack-sheet__reader">
      <span className="stack-sheet__reader-avatar" aria-hidden="true">
        {reader.avatar}
      </span>
      {reader.name}
    </span>
  );
}

/** A string with {reader} in it, with the reader's avatar and name there. */
function withReader(template: string, values: Record<string, string | number>, reader: FamilyReader): ReactNode {
  const [before, after = ''] = fmt(template, values).split('{reader}');
  return (
    <>
      {before}
      <Reader reader={reader} />
      {after}
    </>
  );
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The description, about six lines of it until "Read more". */
function Description({ paragraphs }: { paragraphs: string[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    const resize = new ResizeObserver(check);
    resize.observe(el);
    return () => resize.disconnect();
  }, [open, paragraphs]);
  return (
    <>
      <div ref={box} className={`stack-sheet__description${open ? '' : ' stack-sheet__description--clamped'}`}>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {(overflows || open) && (
        <button type="button" className="btn btn--small-kid stack-sheet__more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t.sheetReadLess : t.sheetReadMore}
        </button>
      )}
    </>
  );
}

function About({ status, retry }: { status: DetailsStatus; retry: () => void }) {
  const headingId = useId();
  if (status.kind === 'idle' || status.kind === 'no-isbn') return null;
  let body: ReactNode;
  if (status.kind === 'loading') {
    body = (
      <div className="stack-sheet__skeleton" role="status">
        <span className="visually-hidden">{t.sheetFinding}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    );
  } else if (status.kind === 'error' || !status.details) {
    body = (
      <div className="stack-sheet__nothing" role="status">
        <p className="muted">{t.sheetNothing}</p>
        {status.kind === 'error' && (
          <button type="button" className="btn btn--small-kid stack-sheet__retry" onClick={retry}>
            {t.sheetRetry}
          </button>
        )}
      </div>
    );
  } else {
    body = <DetailsBody details={status.details} />;
  }
  return (
    <section className="stack-sheet__about" aria-labelledby={headingId}>
      <h3 id={headingId} className="stack-sheet__heading">
        {t.sheetAbout}
      </h3>
      {body}
    </section>
  );
}

function DetailsBody({ details }: { details: BookDetails }) {
  const facts: [string, string][] = [];
  if (details.publisher) facts.push([t.sheetPublisher, details.publisher]);
  if (details.publishYear !== null) facts.push([t.sheetPublished, String(details.publishYear)]);
  if (details.pageCount !== null) facts.push([t.sheetPages, details.pageCount.toLocaleString(locale)]);
  if (details.language) facts.push([t.sheetLanguage, languageName(details.language)]);
  if (details.ageRating === 'mature') facts.push([t.sheetAgeRating, t.sheetAgeMature]);
  return (
    <>
      {details.description.length > 0 && <Description key={details.description.join('\n')} paragraphs={details.description} />}
      {facts.length > 0 && (
        <dl className="stack-sheet__facts">
          {facts.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {details.link && (
        <a className="stack-sheet__link" href={details.link.url} target="_blank" rel="noopener noreferrer">
          {details.link.provider === 'google' ? t.sheetMoreGoogle : t.sheetMoreOpenLibrary}
          <span className="visually-hidden"> {t.sheetNewTab}</span>
        </a>
      )}
    </>
  );
}

interface SheetContentProps {
  item: StackItem;
  book: Book | undefined;
  family: FamilyPart;
  status: DetailsStatus;
  retry: () => void;
  zone: string;
  /** Today in the household's time zone ("YYYY-MM-DD"), for due dates. */
  today: string;
}

/** The book's cover and names, the family's part, then "About this book". Keyed by book, so it fades in anew. */
export function BookSheetContent({ item, book, family, status, retry, zone, today }: SheetContentProps) {
  const details = status.kind === 'ready' ? status.details : null;
  const authors = (book?.authors ?? []).filter(Boolean).join(', ');
  const subtitle = details?.subtitle && !item.title.toLowerCase().includes(details.subtitle.toLowerCase()) ? details.subtitle : null;
  return (
    <div className="stack-sheet__book">
      <div className="stack-sheet__top">
        <div className="stack-sheet__cover">
          <BookCover title={item.title} coverUrl={book?.cover_url ?? null} seed={item.isbn} />
        </div>
        <div className="stack-sheet__names">
          <h2 className="stack-sheet__title">{item.title}</h2>
          {subtitle && <p className="stack-sheet__subtitle">{subtitle}</p>}
          {authors && <p className="muted stack-sheet__authors">{authors}</p>}
        </div>
      </div>

      <ul className="stack-sheet__family">
        <li>
          <span className="stack-sheet__icon" aria-hidden="true">
            ⭐
          </span>
          <span>{withReader(t.sheetFirstRead, { date: readDate(family.first.at, zone, locale) }, family.first)}</span>
        </li>
        <li>
          <span className="stack-sheet__icon" aria-hidden="true">
            📚
          </span>
          <span>{fmt(t.sheetStep, { step: family.step.toLocaleString(locale) })}</span>
        </li>
        {family.total > 0 && (
          <li>
            <span className="stack-sheet__icon" aria-hidden="true">
              🔁
            </span>
            <span>
              {family.total === 1 ? t.sheetReadOnce : fmt(t.sheetReadTimes, { count: family.total.toLocaleString(locale) })}
              <span className="stack-sheet__reads" role="list" aria-label={t.sheetReadsLabel}>
                {family.reads.map((r) => (
                  <span key={r.readerId} role="listitem" className="stack-sheet__read">
                    <Reader reader={r} />
                    <span className="stack-sheet__count">{r.count === 1 ? t.sheetReaderOnce : fmt(t.sheetReaderTimes, { count: r.count.toLocaleString(locale) })}</span>
                  </span>
                ))}
              </span>
            </span>
          </li>
        )}
        {family.home && (
          <li>
            <span className="stack-sheet__icon" aria-hidden="true">
              🏠
            </span>
            <span>{t.sheetHome}</span>
          </li>
        )}
        {family.loans.map((loan, i) => (
          <li key={i}>
            <span className="stack-sheet__icon" aria-hidden="true">
              🏛️
            </span>
            <span className="stack-sheet__loan">
              <span>{loan.library ? fmt(t.sheetLoan, { library: loan.library }) : t.sheetLoanNoLibrary}</span>
              <span>{withReader(t.sheetBorrowedBy, {}, loan.borrower)}</span>
              <DueChip due={loan.due} today={today} />
            </span>
          </li>
        ))}
        {family.collection && (
          <li>
            <span className="stack-sheet__icon" aria-hidden="true">
              📦
            </span>
            <span>
              {family.collection.volume !== null
                ? fmt(t.sheetCollection, { title: family.collection.title, volume: family.collection.volume.toLocaleString(locale) })
                : fmt(t.sheetCollectionNoVolume, { title: family.collection.title })}
            </span>
          </li>
        )}
      </ul>

      <About status={status} retry={retry} />
    </div>
  );
}
