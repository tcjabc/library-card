import { useCallback, useState } from 'react';
import { useDataQuery, type DataStore, type Reader } from '../../data';
import { JOURNEYS, type Journey } from '../../journeys/journeys';
import { navigate } from '../../router';
import { fmt, strings } from '../../strings';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { BackToHub } from '../BackToHub';
import { journeyStyle } from './journeyStyle';
import { useCompletionCheck, useJourneyStatus } from './useJourneyStatus';
import './journeys.css';

/**
 * #/journeys — pick a journey. Tapping one starts it; if another is going,
 * confirm first (the old one stops and stays in the history as abandoned).
 */
export function JourneyGallery({ reader }: { reader: Reader }) {
  const t = strings.journey;
  const toast = useToast();
  const { status, store } = useJourneyStatus(reader.id);
  useCompletionCheck(store, reader.id);
  const countsQuery = useCallback((s: DataStore) => s.countCompletedJourneys(reader.id), [reader.id]);
  const { data: completed } = useDataQuery(countsQuery, ['reader_journeys']);
  const [confirming, setConfirming] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (journey: Journey) => {
    if (!store || busy) return;
    setBusy(true);
    try {
      await store.startJourney(reader.id, journey.id);
      navigate('/journey');
    } catch (error) {
      console.error('[journey] start failed', error);
      toast({ message: t.startError });
      setBusy(false);
    }
  };

  const pick = (journey: Journey) => {
    if (status?.journey.id === journey.id) navigate('/journey');
    else if (status) setConfirming(journey);
    else void start(journey);
  };

  return (
    <main className="page page--kid page--wide">
      <BackToHub />
      <header className="stack">
        <h1 className="kid-title">
          <span aria-hidden="true">🗺️</span> {t.galleryTitle}
        </h1>
        <p className="kid-lead">{t.galleryIntro}</p>
      </header>

      <ul className="journey-grid">
        {JOURNEYS.map((journey) => {
          const active = status?.journey.id === journey.id;
          const times = completed?.[journey.id] ?? 0;
          const label = [
            fmt(t.startLabel, { journey: journey.title, count: journey.steps }),
            active && status ? fmt(t.activeLabel, { progress: status.progress, steps: journey.steps }) : null,
            times === 1 ? t.completedLabelOne : times > 1 ? fmt(t.completedLabel, { count: times }) : null,
          ]
            .filter(Boolean)
            .join('. ');
          return (
            <li key={journey.id}>
              <button
                type="button"
                className={`journey-card${active ? ' journey-card--active' : ''}`}
                style={journeyStyle(journey)}
                aria-label={label}
                aria-current={active ? 'true' : undefined}
                disabled={busy}
                onClick={() => pick(journey)}
              >
                {times > 0 && (
                  <span className="journey-card__done" aria-hidden="true">
                    {fmt(t.completed, { count: times })}
                  </span>
                )}
                <span className="journey-card__emoji" aria-hidden="true">
                  {journey.emoji}
                </span>
                <span className="journey-card__title">{journey.title}</span>
                <span className="journey-card__detail" aria-hidden="true">
                  {active && status
                    ? fmt(t.active, { progress: status.progress, steps: journey.steps })
                    : fmt(t.books, { count: journey.steps })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {confirming && status && (
        <Sheet title={fmt(t.switchTitle, { journey: confirming.title })} onClose={() => setConfirming(null)}>
          <p className="kid-lead">{fmt(t.switchBody, { old: status.journey.title })}</p>
          <div className="action-row">
            <button
              type="button"
              className="btn btn--big btn--primary"
              disabled={busy}
              onClick={() => {
                const next = confirming;
                setConfirming(null);
                void start(next);
              }}
            >
              {fmt(t.switchConfirm, { journey: confirming.title })}
            </button>
            <button type="button" className="btn btn--big" onClick={() => setConfirming(null)}>
              {fmt(t.switchCancel, { old: status.journey.title })}
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
