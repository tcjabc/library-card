import { useCallback, useEffect, useRef } from 'react';
import { useDataQuery, type Book, type DataStore, type Reader } from '../../data';
import { stageAt } from '../../journeys/journeys';
import { booksToGo } from '../../journeys/progress';
import { href, navigate } from '../../router';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { BackToHub } from '../BackToHub';
import { journeyStyle } from './journeyStyle';
import { useCompletionCheckOnOpen, useJourneyStatus } from './useJourneyStatus';
import './journeys.css';

/**
 * #/journey — the active journey as a vertical track: the finish at the top
 * (at the bottom for journeys that go down), numbered steps, stage labels,
 * covers of the books that filled each step and the reader's avatar on the
 * step they've reached. No active journey: go to the gallery.
 */
export function JourneyScreen({ reader }: { reader: Reader }) {
  const t = strings.journey;
  const { status, loading, store } = useJourneyStatus(reader.id);
  useCompletionCheckOnOpen(store, reader.id);

  const isbns = (status?.filled ?? []).map((f) => f.isbn).join('|');
  const booksQuery = useCallback(
    (s: DataStore) => (isbns ? s.getBooks(isbns.split('|')) : Promise.resolve([] as Book[])),
    [isbns],
  );
  const { data: books } = useDataQuery(booksQuery, ['books', 'covers']);
  const bookByIsbn = new Map((books ?? []).map((b) => [b.isbn, b]));

  const noJourney = !loading && store !== null && status === null;
  useEffect(() => {
    if (noJourney) navigate('/journeys', { replace: true });
  }, [noJourney]);

  // Start with the avatar in view (long journeys are taller than the screen).
  const here = useRef<HTMLLIElement>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!status || scrolledFor.current === status.record.id || !here.current) return;
    scrolledFor.current = status.record.id;
    here.current.scrollIntoView({ block: 'center', behavior: 'instant' });
  });

  if (!status) return <main className="page page--kid" aria-busy="true" />;

  const { journey, progress } = status;
  const down = journey.direction === 'down';
  const toGo = booksToGo(progress, journey.steps);
  const fillByStep = new Map(status.filled.map((f) => [f.step, f]));
  const steps = Array.from({ length: journey.steps }, (_, i) => i + 1);
  const ordered = down ? steps : [...steps].reverse();

  const finish = (
    <li className="journey-track__end journey-track__end--finish">
      <span className="journey-track__end-emoji" aria-hidden="true">
        {down ? '🐚' : '🏁'}
      </span>
      <span>{down ? t.finishDown : t.finishUp}</span>
    </li>
  );
  const startRow = (
    <li ref={progress === 0 ? here : undefined} className="journey-track__end">
      {progress === 0 && <Avatar reader={reader} />}
      <span>{t.start}</span>
    </li>
  );

  return (
    <main className="page page--kid journey-page" style={journeyStyle(journey)}>
      <div className="row journey-page__nav">
        <BackToHub />
        <a className="link-quiet journey-page__change" href={href('/journeys')}>
          {t.change}
        </a>
      </div>
      <header className="center-stack">
        <h1 className="kid-title">
          <span aria-hidden="true">{journey.emoji}</span> {journey.title}
        </h1>
        <p className="journey-page__to-go">{toGo === 1 ? t.toGoOne : fmt(t.toGo, { count: toGo })}</p>
      </header>

      <ol
        className={`journey-track${down ? ' journey-track--down' : ''}`}
        aria-label={fmt(t.trackLabel, { journey: journey.title, progress, steps: journey.steps })}
      >
        {down ? startRow : finish}
        {ordered.map((step) => {
          const fill = fillByStep.get(step);
          const book = fill ? bookByIsbn.get(fill.isbn) : undefined;
          const title = book?.title ?? strings.shelf.thisBook;
          const stage = stageAt(journey, step);
          const current = step === progress;
          return (
            <li
              key={step}
              ref={current ? here : undefined}
              className={`journey-step${fill ? ' journey-step--filled' : ''}${current ? ' journey-step--current' : ''}`}
              aria-label={fill ? fmt(t.stepFilled, { step, title }) : fmt(t.step, { step })}
              aria-current={current ? 'step' : undefined}
            >
              <span className="journey-step__stage">{stage}</span>
              <span className="journey-step__dot" aria-hidden="true">
                {current ? <Avatar reader={reader} /> : step}
              </span>
              <span className="journey-step__cover" aria-hidden="true">
                {fill && <BookCover title={title} coverUrl={book?.cover_url ?? null} />}
              </span>
            </li>
          );
        })}
        {down ? finish : startRow}
      </ol>
    </main>
  );
}

function Avatar({ reader }: { reader: Reader }) {
  return (
    <span className="journey-avatar" title={strings.journey.youAreHere}>
      <span className="visually-hidden">{strings.journey.youAreHere}</span>
      <span aria-hidden="true">{reader.avatar}</span>
    </span>
  );
}
