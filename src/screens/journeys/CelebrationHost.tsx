import { useCallback, useEffect, useId, useRef } from 'react';
import { useDataQuery, type DataStore } from '../../data';
import { isGrownUpPath } from '../../grownups/session';
import { ensureCelebrationList, markCelebrated, nextCelebration, useCelebrationList } from '../../journeys/celebration';
import { getJourney } from '../../journeys/journeys';
import { navigate, useHashPath } from '../../router';
import { useActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { confettiBurst, prefersReducedMotion } from '../../ui/confetti';
import { journeyStyle } from './journeyStyle';
import './journeys.css';

const BURSTS = 6;
const BURST_EVERY_MS = 450;

/**
 * Full-screen "You reached the top!" over whatever screen the reader is on, for a finished
 * journey this device hasn't celebrated yet (journeys/celebration.ts), however it was finished:
 * here, in another tab, or on another device through sync. Dismissing it marks it celebrated on
 * this device. Not shown in the grown-up area.
 */
export function CelebrationHost() {
  const readerId = useActiveReaderId();
  const path = useHashPath();
  const { celebrated, paused } = useCelebrationList();
  const query = useCallback((s: DataStore) => (readerId ? s.listJourneyHistory(readerId) : Promise.resolve([])), [readerId]);
  const { data: history, store } = useDataQuery(query, ['reader_journeys']);

  // First run of this version: make the list from the completions that already exist.
  useEffect(() => {
    if (store && celebrated === null) void ensureCelebrationList(store).catch((error: unknown) => console.error('[celebration] list', error));
  }, [store, celebrated]);

  const due = celebrated && !paused && history ? nextCelebration(history, celebrated) : null;
  if (!readerId || !due || path === '/' || isGrownUpPath(path)) return null;
  return <Celebration key={due.id} readerJourneyId={due.id} journeyId={due.journey_id} />;
}

function Celebration({ readerJourneyId, journeyId }: { readerJourneyId: string; journeyId: string }) {
  const t = strings.journey;
  const journey = getJourney(journeyId);
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const done = () => {
    markCelebrated(readerJourneyId);
    navigate('/journeys');
  };

  useEffect(() => {
    button.current?.focus();
    if (prefersReducedMotion()) return;
    let fired = 0;
    const fire = () => {
      confettiBurst(
        { x: window.innerWidth * (0.15 + Math.random() * 0.7), y: window.innerHeight * (0.15 + Math.random() * 0.45) },
        { size: 'big' },
      );
      fired += 1;
    };
    fire();
    const timer = setInterval(() => (fired < BURSTS ? fire() : clearInterval(timer)), BURST_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  // Keep the page behind still while the overlay is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const down = journey?.direction === 'down';
  return (
    <div
      className="celebration"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={journey ? journeyStyle(journey) : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') done();
      }}
    >
      <div className="celebration__body">
        <span className="celebration__badge" aria-hidden="true">
          {journey?.emoji ?? '🏆'}
        </span>
        <h2 id={titleId} className="celebration__title">
          {down ? t.celebrateDown : t.celebrateUp}
        </h2>
        {journey && <p className="kid-lead">{fmt(t.celebrateBody, { journey: journey.title, steps: journey.steps })}</p>}
        <button ref={button} type="button" className="btn btn--big btn--accent" onClick={done}>
          {t.celebrateNext}
        </button>
      </div>
    </div>
  );
}
