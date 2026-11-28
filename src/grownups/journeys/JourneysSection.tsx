import { lazy, Suspense, useCallback, useState } from 'react';
import { customJourneyRef, useDataQuery, type CustomJourney, type DataStore, type Household } from '../../data';
import { getJourney } from '../../journeys/journeys';
import { customJourneyDefinition } from '../../journeys/resolve';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { useToast } from '../../ui/Toast';
import { useGrownUpSession } from '../useGrownUpSession';
import './customJourneys.css';

const t = strings.grownups.customJourneys;
const CustomJourneyForm = lazy(() => import('./CustomJourneyForm'));

/** The household's custom journeys, archived ones too, and how many readers are on each. */
async function loadJourneys(store: DataStore, householdId: string) {
  const [journeys, readers] = await Promise.all([store.listCustomJourneys(householdId, { includeArchived: true }), store.listReaders(householdId)]);
  const active = await Promise.all(readers.map((r) => store.getActiveJourney(r.id)));
  const on = new Map<string, number>();
  for (const record of active) if (record) on.set(record.journey_id, (on.get(record.journey_id) ?? 0) + 1);
  return { journeys, on };
}

/**
 * Grown-ups → Readers → Journeys (1.26.0, its own chunk): the household's custom journeys (a
 * picture, a length and a name), with how many readers are on each; make, edit (rename, longer
 * only) and archive. Archived ones fold away; nothing is ever deleted.
 */
export default function JourneysSection({ store, household }: { store: DataStore; household: Household }) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const query = useCallback((s: DataStore) => loadJourneys(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['custom_journeys', 'readers', 'reader_journeys']);
  const [editing, setEditing] = useState<CustomJourney | 'new' | null>(null);
  const [archiving, setArchiving] = useState<CustomJourney | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const all = data?.journeys ?? [];
  const live = all.filter((j) => j.archived_at === null);
  const archived = all.filter((j) => j.archived_at !== null);

  const row = (journey: CustomJourney) => {
    const def = customJourneyDefinition(journey);
    const theme = getJourney(journey.theme);
    const on = data?.on.get(customJourneyRef(journey.id)) ?? 0;
    const details = [fmt(t.books, { count: journey.steps }), theme?.title, on === 1 ? t.readersOnOne : on > 1 ? fmt(t.readersOn, { count: on }) : null].filter(Boolean).join(' · ');
    return (
      <li key={journey.id} className="dev-list__row">
        <div>
          <p>
            <span aria-hidden="true">{theme?.emoji}</span> {def?.title ?? journey.name}
            {journey.archived_at !== null && <span className="chip-tag">{t.archived}</span>}
          </p>
          <p className="small muted">{details}</p>
        </div>
        {journey.archived_at === null && (
          <div className="row">
            <button type="button" className="btn btn--small" onClick={() => setEditing(journey)}>
              {t.edit}
            </button>
            <button type="button" className="btn btn--small" onClick={() => setArchiving(journey)}>
              {t.archive}
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="stack card" aria-labelledby="custom-journeys-heading">
      <h2 id="custom-journeys-heading">{t.heading}</h2>
      <p>{t.intro}</p>
      {data && live.length === 0 && <p className="muted">{t.none}</p>}
      {live.length > 0 && <ul className="dev-list">{live.map(row)}</ul>}
      {archived.length > 0 && (
        <>
          <button type="button" className="btn btn--small" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? t.hideArchived : fmt(t.showArchived, { count: archived.length })}
          </button>
          {showArchived && <ul className="dev-list">{archived.map(row)}</ul>}
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          <span aria-hidden="true">➕</span> {t.create}
        </button>
      </div>

      {editing && (
        <Suspense fallback={null}>
          <CustomJourneyForm store={store} householdId={household.id} journey={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        </Suspense>
      )}
      {archiving && (
        <ConfirmSheet
          title={fmt(t.archiveTitle, { journey: customJourneyDefinition(archiving)?.title ?? '' })}
          confirmLabel={t.archiveConfirm}
          errorText={t.archiveFailed}
          onClose={() => setArchiving(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.archiveCustomJourney(archiving.id);
              setArchiving(null);
              toast({ message: t.archivedToast });
            }, strings.gate.reasonArchiveJourney)
          }
        >
          <p>{t.archiveBody}</p>
        </ConfirmSheet>
      )}
    </section>
  );
}
