import { useId } from 'react';
import { getJourney } from '../journeys/journeys';
import { readJourneySlow, useJourneySlow, useSceneMotionReadout, writeJourneySlow } from '../screens/journeys/sceneMotionDev';
import { fmt, strings } from '../strings';

const t = strings.dev;

/**
 * Dev only: the journey scenes' slow-device drop-out (src/journeys/sceneBudget.ts). "Pretend slow
 * frames on journey screens" (this device) and what the last journey screen did this session.
 */
export function JourneyMotionPanel() {
  const noteId = useId();
  const slow = useJourneySlow();
  const last = useSceneMotionReadout();
  return (
    <section className="stack card">
      <h2>{t.journeyHeading}</h2>
      <p className="muted small">{t.journeyIntro}</p>
      <div className="row">
        <button type="button" className="chip" aria-pressed={slow} aria-describedby={noteId} onClick={() => writeJourneySlow(!readJourneySlow())}>
          {t.journeySlow}
        </button>
      </div>
      <p id={noteId} className="small muted">
        {t.journeySlowNote}
      </p>
      <p className="small" role="status">
        <strong>{t.journeyLast}</strong>{' '}
        {last
          ? fmt(t.journeyLastValue, {
              journey: getJourney(last.journeyId)?.title ?? last.journeyId,
              level: t.decorLevel[last.level],
              why: t.decorWhy[last.why],
              setting: t.decorLevel[last.setting],
              cap: t.decorLevel[last.cap],
            })
          : t.journeyLastNone}
      </p>
      {last && (
        <p className="small">
          <strong>{t.journeySteps}</strong>{' '}
          {last.steps.length
            ? last.steps
                .map((step) => fmt(t.journeyStep, { from: t.decorLevel[step.from], to: t.decorLevel[step.to], seconds: (step.atMs / 1000).toFixed(1) }))
                .join(' · ')
            : t.journeyNoSteps}
        </p>
      )}
    </section>
  );
}
