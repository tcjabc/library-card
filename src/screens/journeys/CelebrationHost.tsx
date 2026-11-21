import { useEffect, useId, useRef } from 'react';
import { isGrownUpPath } from '../../grownups/session';
import { clearPendingCelebration, usePendingCelebration } from '../../journeys/celebration';
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
 * Full-screen "You reached the top!" over whatever screen the reader is on,
 * when their pending-celebration flag is set (see journeys/completion.ts).
 * The flag is cleared when they dismiss it. Not shown in the grown-up area.
 */
export function CelebrationHost() {
  const readerId = useActiveReaderId();
  const journeyId = usePendingCelebration(readerId);
  const path = useHashPath();
  if (!readerId || !journeyId || path === '/' || isGrownUpPath(path)) return null;
  return <Celebration key={`${readerId}:${journeyId}`} readerId={readerId} journeyId={journeyId} />;
}

function Celebration({ readerId, journeyId }: { readerId: string; journeyId: string }) {
  const t = strings.journey;
  const journey = getJourney(journeyId);
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const done = () => {
    clearPendingCelebration(readerId);
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
