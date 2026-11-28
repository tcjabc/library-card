import { lazy, Suspense, useState } from 'react';
import { customJourneyRef, type DataStore } from '../../data';
import { listedCustomJourneys, type ResolvedJourney } from '../../journeys/resolve';
import { useCustomJourneys } from '../../journeys/useCustomJourneys';
import { POSTER_JOURNEYS } from '../../posters/art';
import { fmt, strings } from '../../strings';
import { PrintPages, usePrint } from '../../ui/print/PrintRoot';
import { ScaledPage } from '../../ui/print/ScaledPage';
import { PosterSheet } from './JourneyPoster';
import './posters-print.css';

const t = strings.grownups.posters;
const POSTERS_JOB = 'posters';
/** The same form as Grown-ups → Readers → Journeys (its own chunk). */
const CustomJourneyForm = lazy(() => import('../journeys/CustomJourneyForm'));

/**
 * Grown-ups > Cards > Journey posters (1.23.0, its own chunk): pick journeys, see the first one,
 * print one poster per A4 page. Only journeys with poster art are listed (src/posters/art), then
 * the household's own (1.26.0: not archived ones), with "Create custom journey" here too.
 */
export default function PostersSection({ store, householdId }: { store: DataStore; householdId: string }) {
  const print = usePrint();
  const posters: readonly ResolvedJourney[] = [...POSTER_JOURNEYS, ...listedCustomJourneys(useCustomJourneys())];
  // The first poster, until a grown-up picks others.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(POSTER_JOURNEYS.slice(0, 1).map((j) => j.id)));
  const [creating, setCreating] = useState(false);
  const chosen = posters.filter((journey) => picked.has(journey.id));
  const everything = chosen.length === posters.length;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (POSTER_JOURNEYS.length === 0) return null;
  const first = chosen[0];

  return (
    <>
      <section className="stack card">
        <h2>{t.heading}</h2>
        <p>{t.intro}</p>
        <div className="stack">
          <p className="field-label" id="poster-pick-label">
            {t.pick}
          </p>
          <div className="chip-row chip-row--dense" role="group" aria-labelledby="poster-pick-label">
            <button type="button" className="chip" aria-pressed={everything} onClick={() => setPicked(new Set(everything ? [] : posters.map((j) => j.id)))}>
              {t.all}
            </button>
            {posters.map((journey) => (
              <button key={journey.id} type="button" className="chip" aria-pressed={picked.has(journey.id)} onClick={() => toggle(journey.id)}>
                <span aria-hidden="true">{journey.emoji}</span> {journey.title}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={chosen.length === 0} onClick={() => print(POSTERS_JOB)}>
            🖨️ {chosen.length === 1 ? t.printOne : fmt(t.print, { count: chosen.length })}
          </button>
          {chosen.length === 0 && <span className="small muted">{t.nothingPicked}</span>}
        </div>
        {chosen.length > 0 && (
          <>
            <p className="small muted">{t.printTip}</p>
            <p className="small muted">{strings.grownups.cards.pdfHint}</p>
          </>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <span aria-hidden="true">➕</span> {strings.grownups.customJourneys.create}
          </button>
        </div>
      </section>

      {creating && (
        <Suspense fallback={null}>
          <CustomJourneyForm
            store={store}
            householdId={householdId}
            journey={null}
            onClose={() => setCreating(false)}
            onSaved={(saved) => setPicked(new Set([customJourneyRef(saved.id)]))}
          />
        </Suspense>
      )}

      {first && (
        <section className="stack" aria-label={t.preview}>
          <h2>{t.preview}</h2>
          <figure className="card-preview">
            <figcaption className="small muted">{chosen.length === 1 ? first.title : fmt(t.previewFirst, { journey: first.title, count: chosen.length })}</figcaption>
            <ScaledPage>
              <PosterSheet journey={first} />
            </ScaledPage>
          </figure>
        </section>
      )}

      <PrintPages job={POSTERS_JOB}>
        {chosen.map((journey) => (
          <PosterSheet key={journey.id} journey={journey} />
        ))}
      </PrintPages>
    </>
  );
}
