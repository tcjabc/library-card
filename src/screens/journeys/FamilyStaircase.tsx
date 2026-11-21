import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useDataQuery, type Book, type DataStore, type Reader, type ReadSummary } from '../../data';
import {
  NOVELTIES,
  assignReaderColors,
  avatarSteps,
  isMilestone,
  placeNovelties,
  staircaseOrder,
  visibleWindow,
} from '../../journeys/staircase';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { BackToHub } from '../BackToHub';
import { fakeReads, useFakeStaircaseSteps } from './fakeStaircase';
import './journeys.css';

/**
 * #/staircase — every book anyone in the household has read (its first read)
 * is a step, zig-zagging up, newest at the top. Milestone flags, novelties
 * beside some steps and each reader's avatar on their latest step.
 *
 * Virtualised: steps have a fixed height (--stair-step), so only the ones on
 * screen plus a buffer are rendered, positioned absolutely inside a box as
 * tall as the whole staircase. The page itself scrolls (window scroll).
 */

const READER_COLOURS = 8;
const BUFFER = 6;

interface StaircaseData {
  stairs: ReadSummary[];
  readers: Reader[];
  books: Map<string, Book>;
}

async function loadStaircase(store: DataStore, householdId: string, fake: number | null): Promise<StaircaseData> {
  const readers = await store.listReaders(householdId);
  if (fake) return { stairs: fakeReads(fake, readers, householdId), readers, books: new Map() };
  const summaries = await store.listHouseholdReadSummaries(householdId);
  const stairs = staircaseOrder(summaries);
  const books = await store.getBooks([...new Set(stairs.map((s) => s.isbn))]);
  return { stairs, readers, books: new Map(books.map((b) => [b.isbn, b])) };
}

export function FamilyStaircase({ reader }: { reader: Reader }) {
  const t = strings.staircase;
  const fake = useFakeStaircaseSteps();
  const query = useCallback((s: DataStore) => loadStaircase(s, reader.household_id, fake), [reader.household_id, fake]);
  const { data, loading } = useDataQuery(query, ['readers', 'read_events', 'books', 'covers']);

  const count = data?.stairs.length ?? 0;
  const derived = useMemo(() => {
    if (!data) return null;
    const readerById = new Map(data.readers.map((r) => [r.id, r]));
    const colours = assignReaderColors(data.readers.map((r) => r.id), READER_COLOURS);
    // Avatars: step -> readers standing there.
    const avatarsAt = new Map<number, Reader[]>();
    for (const [readerId, step] of avatarSteps(data.stairs)) {
      const who = readerById.get(readerId);
      if (who) avatarsAt.set(step, [...(avatarsAt.get(step) ?? []), who]);
    }
    const novelties = placeNovelties(reader.household_id, data.stairs.length, NOVELTIES.length);
    return { readerById, colours, avatarsAt, novelties };
  }, [data, reader.household_id]);

  return (
    <main className="page page--kid stairs-page">
      <BackToHub />
      <header className="center-stack">
        <h1 className="kid-title">
          <span aria-hidden="true">🪜</span> {t.title}
        </h1>
        {data && (
          <p className="kid-stat">
            <span className="kid-stat__number">{count.toLocaleString()}</span>
            <span>{count === 1 ? t.totalOne : t.total}</span>
          </p>
        )}
        {fake && <p className="alert">{fmt(t.fake, { count: fake.toLocaleString() })}</p>}
      </header>

      {loading || !data || !derived ? (
        <p className="muted">{strings.common.loading}</p>
      ) : count === 0 ? (
        <div className="empty-state">
          <p className="kid-emoji" aria-hidden="true">
            🧱
          </p>
          <p className="kid-lead">{t.empty}</p>
        </div>
      ) : (
        <>
          <p className="muted center-text">{t.intro}</p>
          <Stairs {...data} {...derived} />
        </>
      )}
    </main>
  );
}

interface StairsProps extends StaircaseData {
  readerById: Map<string, Reader>;
  colours: Map<string, number>;
  avatarsAt: Map<number, Reader[]>;
  novelties: (number | null)[];
}

function Stairs({ stairs, books, readerById, colours, avatarsAt, novelties }: StairsProps) {
  const count = stairs.length;
  const box = useRef<HTMLOListElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [stepHeight, setStepHeight] = useState(0);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 20) });

  // The step height comes from the --stair-step token; measure it in px.
  useLayoutEffect(() => {
    const measure = () => setStepHeight(probe.current?.offsetHeight ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useLayoutEffect(() => {
    if (!stepHeight) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = box.current?.getBoundingClientRect().top ?? 0;
      const next = visibleWindow({ scrollTop: -top, viewportHeight: window.innerHeight, itemHeight: stepHeight, count, buffer: BUFFER });
      setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [stepHeight, count]);

  const rows = [];
  for (let index = range.start; index < range.end; index++) {
    const step = count - index; // newest (highest step) at the top
    const read = stairs[step - 1];
    const who = readerById.get(read.reader_id);
    const novelty = novelties[step - 1];
    rows.push(
      <Step
        key={step}
        step={step}
        top={index * stepHeight}
        read={read}
        book={books.get(read.isbn)}
        reader={who}
        colour={(colours.get(read.reader_id) ?? 0) + 1}
        avatars={avatarsAt.get(step)}
        novelty={novelty}
      />,
    );
  }

  return (
    <>
      <div ref={probe} className="stairs__probe" aria-hidden="true" />
      <ol
        ref={box}
        className="stairs"
        style={{ height: stepHeight ? count * stepHeight : undefined }}
        aria-label={strings.staircase.title}
      >
        {stepHeight > 0 && rows}
      </ol>
    </>
  );
}

interface StepProps {
  step: number;
  top: number;
  read: ReadSummary;
  book: Book | undefined;
  reader: Reader | undefined;
  colour: number;
  avatars: Reader[] | undefined;
  novelty: number | null;
}

const Step = memo(function Step({ step, top, book, reader, colour, avatars, novelty }: StepProps) {
  const t = strings.staircase;
  const title = book?.title ?? strings.shelf.thisBook;
  const milestone = isMilestone(step);
  const side = step % 2 === 0 ? 'right' : 'left';
  const decoration = novelty !== null ? NOVELTIES[novelty] : null;
  return (
    <li
      className={`stair stair--${side}${step === 1 ? ' stair--first' : ''}`}
      style={{ transform: `translateY(${top}px)`, '--reader-color': `var(--reader-${colour})` } as CSSProperties}
      aria-label={fmt(t.stepLabel, { step, reader: reader?.display_name ?? t.someone, title })}
    >
      <div className="stair__block">
        <span className="stair__number" aria-hidden="true">
          {step}
        </span>
        <span className="stair__cover" aria-hidden="true">
          <BookCover title={title} coverUrl={book?.cover_url ?? null} />
        </span>
        {avatars && (
          <span className="stair__avatars">
            {avatars.map((a) => (
              <span key={a.id} className="stair__avatar" title={a.display_name}>
                {a.avatar}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="stair__beside">
        {milestone ? (
          <span className="stair__milestone">
            <span aria-hidden="true">🚩</span> {fmt(t.milestone, { count: step.toLocaleString() })}
          </span>
        ) : step === 1 ? (
          <span className="stair__first">{t.first}</span>
        ) : decoration ? (
          <span className="stair__novelty" role="img" aria-label={t.novelties[decoration.id]}>
            {decoration.emoji}
          </span>
        ) : null}
      </div>
    </li>
  );
});
