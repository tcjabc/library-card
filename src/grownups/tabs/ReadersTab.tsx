import { lazy, Suspense, useCallback, useId, useState, type FormEvent } from 'react';
import { useCardQr } from '../../cards/useCardQr';
import {
  CONFIRMED_BY_PIN,
  READER_KINDS,
  isDataStoreError,
  useDataQuery,
  type DataStore,
  type DeleteReaderPreview,
  type Household,
  type Reader,
  type ReaderKind,
} from '../../data';
import { loadJourney } from '../../journeys/resolve';
import { journeyProgress } from '../../journeys/progress';
import { NotesSection } from '../../notes/NotesSection';

/** Custom journeys (1.26.0): their own chunk. */
const JourneysSection = lazy(() => import('../journeys/JourneysSection'));
import { ToCheckList } from '../../reads/ToCheckList';
import { AvatarPicker } from '../../readers/AvatarPicker';
import { DEFAULT_AVATAR } from '../../readers/avatars';
import { href } from '../../router';
import { clearActiveReader, getActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { MoreMenu } from '../../ui/MoreMenu';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { ViewToggle } from '../../ui/ViewToggle';
import { readStats, tabPath } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
import { useGrownUpView } from '../views';
import type { TabProps } from './types';

const t = strings.grownups.readers;

interface ReaderRow {
  reader: Reader;
  booksRead: number;
  rereads: number;
  journey: { emoji: string; title: string; progress: number; steps: number } | null;
  completed: number;
}

async function loadReaders(store: DataStore, householdId: string): Promise<ReaderRow[]> {
  const readers = await store.listReaders(householdId);
  return Promise.all(
    readers.map(async (reader) => {
      const [summaries, active, completed] = await Promise.all([
        store.listReadSummaries(reader.id),
        store.getActiveJourney(reader.id),
        store.countCompletedJourneys(reader.id),
      ]);
      const def = active ? await loadJourney(store, active.journey_id) : undefined;
      return {
        reader,
        ...readStats(summaries),
        journey:
          active && def
            ? { emoji: def.emoji, title: def.title, steps: def.steps, progress: journeyProgress(summaries, active.started_at, def.steps) }
            : null,
        completed: Object.values(completed).reduce((sum, n) => sum + n, 0),
      };
    }),
  );
}

type Dialog =
  | { kind: 'edit'; reader: Reader | null }
  | { kind: 'replace'; reader: Reader }
  | { kind: 'new-card'; reader: Reader }
  | { kind: 'delete'; reader: Reader; preview: DeleteReaderPreview };

function statsLine({ booksRead, rereads }: ReaderRow): string {
  return `${booksRead === 1 ? t.booksReadOne : fmt(t.booksRead, { count: booksRead })} · ${rereads === 1 ? t.rereadsOne : fmt(t.rereads, { count: rereads })}`;
}

function journeyLine({ journey, completed }: ReaderRow): string {
  const now = journey ? fmt(t.journeyNow, { emoji: journey.emoji, journey: journey.title, progress: journey.progress, steps: journey.steps }) : t.noJourney;
  return completed > 0 ? `${now} · ${completed === 1 ? t.completedOne : fmt(t.completed, { count: completed })}` : now;
}

/** Grown-ups > Readers: who reads here, how much, and their cards (a List, or a Grid of cards). */
export function ReadersTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const query = useCallback((s: DataStore) => loadReaders(s, household.id), [household.id]);
  const { data: rows } = useDataQuery(query, ['readers', 'read_events', 'reader_journeys', 'loans']);
  const pendingQuery = useCallback((s: DataStore) => s.listPendingReads(household.id), [household.id]);
  const { data: pendingReads = [] } = useDataQuery(pendingQuery, ['read_events']);
  const toCheck = new Map<string, number>();
  for (const event of pendingReads) toCheck.set(event.reader_id, (toCheck.get(event.reader_id) ?? 0) + 1);
  const [checkFilter, setCheckFilter] = useState<string | null>(null);
  const [view, setView] = useGrownUpView('readers');

  const askDelete = async (reader: Reader) => {
    const preview = await store.previewDeleteReader(reader.id);
    setDialog({ kind: 'delete', reader, preview });
  };

  const childrenWaiting = (rows ?? []).map((r) => r.reader).filter((r) => toCheck.has(r.id));

  return (
    <>
      {pendingReads.length > 0 && (
        <section className="stack card" aria-labelledby="readers-to-check">
          <h2 id="readers-to-check">
            <span aria-hidden="true">📝</span> {strings.reads.toCheckHeading} ({pendingReads.length})
          </h2>
          <p className="small muted">{strings.reads.toCheckIntro}</p>
          <div className="chip-row chip-row--dense" role="group" aria-labelledby="readers-to-check">
            <button type="button" className="chip" aria-pressed={checkFilter === null} onClick={() => setCheckFilter(null)}>
              {strings.reads.all}
            </button>
            {childrenWaiting.map((r) => (
              <button key={r.id} type="button" className="chip" aria-pressed={checkFilter === r.id} onClick={() => setCheckFilter(r.id)}>
                <span aria-hidden="true">{r.avatar}</span> {r.display_name} ({toCheck.get(r.id)})
              </button>
            ))}
          </div>
          <ToCheckList householdId={household.id} readerId={checkFilter} confirmedBy={CONFIRMED_BY_PIN} />
        </section>
      )}
      <section className="stack card">
        <div className="row grownups__section-head">
          <h2>{fmt(t.heading, { count: rows?.length ?? 0 })}</h2>
          <div className="row">
            {!!rows?.length && <ViewToggle view={view} onChange={setView} label={strings.grownups.viewLabel} dense />}
            <button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: 'edit', reader: null })}>
              {t.add}
            </button>
          </div>
        </div>
        {rows && rows.length === 0 && <p className="muted">{t.none}</p>}
        {view === 'grid' ? (
          <ul className="gu-grid">
            {rows?.map((row) => {
              const { reader } = row;
              const waiting = toCheck.get(reader.id) ?? 0;
              return (
                <li key={reader.id} className="gu-card">
                  <div className="gu-card__head">
                    <span className="avatar avatar--md" aria-hidden="true">
                      {reader.avatar}
                    </span>
                    <div className="stack grownups-reader__body">
                      <p className="gu-card__title">{reader.display_name}</p>
                      <p className="small muted">{t.kinds[reader.kind]}</p>
                    </div>
                  </div>
                  <p className="small">{statsLine(row)}</p>
                  <p className="small muted">{journeyLine(row)}</p>
                  {waiting > 0 && (
                    <div className="row">
                      <button type="button" className="btn btn--small" onClick={() => setCheckFilter(reader.id)}>
                        📝 {fmt(t.toCheck, { count: waiting })}
                      </button>
                    </div>
                  )}
                  <MoreMenu
                    label={fmt(strings.grownups.moreFor, { name: reader.display_name })}
                    items={[
                      { label: t.edit, onSelect: () => setDialog({ kind: 'edit', reader }) },
                      { label: t.replaceCard, onSelect: () => setDialog({ kind: 'replace', reader }) },
                      { label: t.delete, onSelect: () => void askDelete(reader), danger: true },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="dev-list">
            {rows?.map(({ reader, booksRead, rereads, journey, completed }) => (
              <li key={reader.id} className="dev-list__row">
                <div className="grownups-reader">
                  <span className="avatar avatar--md" aria-hidden="true">
                    {reader.avatar}
                  </span>
                  <div className="stack grownups-reader__body">
                    <p className="grownups__item-title">
                      {reader.display_name}
                      {reader.kind === 'grown_up' && <span className="small muted"> · {t.grownUpTag}</span>}
                      {(toCheck.get(reader.id) ?? 0) > 0 && (
                        <button type="button" className="btn btn--small grownups__to-check" onClick={() => setCheckFilter(reader.id)}>
                          📝 {fmt(t.toCheck, { count: toCheck.get(reader.id) ?? 0 })}
                        </button>
                      )}
                    </p>
                    <p className="small">
                      {booksRead === 1 ? t.booksReadOne : fmt(t.booksRead, { count: booksRead })} ·{' '}
                      {rereads === 1 ? t.rereadsOne : fmt(t.rereads, { count: rereads })}
                    </p>
                    <p className="small muted">
                      {journey ? fmt(t.journeyNow, { emoji: journey.emoji, journey: journey.title, progress: journey.progress, steps: journey.steps }) : t.noJourney}
                      {completed > 0 && ` · ${completed === 1 ? t.completedOne : fmt(t.completed, { count: completed })}`}
                    </p>
                  </div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn--small" onClick={() => setDialog({ kind: 'edit', reader })}>
                    {t.edit}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => setDialog({ kind: 'replace', reader })}>
                    {t.replaceCard}
                  </button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => void askDelete(reader)}>
                    {t.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NotesSection store={store} household={household} />
      <Suspense fallback={null}>
        <JourneysSection store={store} household={household} />
      </Suspense>

      {dialog?.kind === 'edit' && (
        <ReaderForm key={dialog.reader?.id ?? 'new'} store={store} household={household} reader={dialog.reader} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'replace' && (
        <ConfirmSheet
          title={fmt(t.replaceTitle, { name: dialog.reader.display_name })}
          confirmLabel={t.replaceConfirm}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              const next = await store.rotateCardToken(dialog.reader.id);
              toast({ message: fmt(t.replaced, { name: next.display_name }) });
              setDialog({ kind: 'new-card', reader: next });
            }, strings.gate.reasonRotate)
          }
        >
          <p>{t.replaceBody}</p>
        </ConfirmSheet>
      )}

      {dialog?.kind === 'new-card' && <NewCardSheet reader={dialog.reader} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'delete' && dialog.preview.activeLoans > 0 && (
        <Sheet title={fmt(t.blockedTitle, { name: dialog.reader.display_name })} onClose={() => setDialog(null)}>
          <p>
            {dialog.preview.activeLoans === 1
              ? fmt(t.blockedBodyOne, { name: dialog.reader.display_name })
              : fmt(t.blockedBody, { name: dialog.reader.display_name, count: dialog.preview.activeLoans })}
          </p>
          <div className="row">
            <a className="btn btn--primary" href={href(tabPath('loans', { reader: dialog.reader.id }))}>
              {fmt(t.blockedLink, { name: dialog.reader.display_name })}
            </a>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {strings.common.close}
            </button>
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'delete' && dialog.preview.activeLoans === 0 && (
        <ConfirmSheet
          title={fmt(t.deleteTitle, { name: dialog.reader.display_name })}
          confirmLabel={fmt(t.deleteConfirm, { name: dialog.reader.display_name })}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              try {
                await store.deleteReader(dialog.reader.id);
              } catch (error) {
                // A loan was added meanwhile (another tab): show why instead.
                if (isDataStoreError(error, 'blocked')) return void (await askDelete(dialog.reader));
                throw error;
              }
              // This device was signed in as them: nobody is now.
              if (getActiveReaderId() === dialog.reader.id) clearActiveReader();
              setDialog(null);
              toast({ message: fmt(t.deleted, { name: dialog.reader.display_name }) });
            }, strings.gate.reasonDeleteReader)
          }
        >
          <p>{fmt(t.deleteBody, { name: dialog.reader.display_name })}</p>
          <ul className="grownups__counts">
            <li>{fmt(t.deleteReads, { reads: dialog.preview.readEvents, books: dialog.preview.booksRead })}</li>
            {dialog.preview.notes > 0 && <li>{fmt(t.deleteNotes, { count: dialog.preview.notes })}</li>}
            <li>{fmt(t.deleteJourneys, { count: dialog.preview.journeys })}</li>
            <li>{fmt(t.deleteLoans, { count: dialog.preview.returnedLoans })}</li>
            {dialog.preview.libraryCards > 0 && <li>{fmt(t.deleteLibraryCards, { count: dialog.preview.libraryCards })}</li>}
          </ul>
          <p className="alert">{t.deleteWarning}</p>
        </ConfirmSheet>
      )}
    </>
  );
}

function ReaderForm({ store, household, reader, onClose }: { store: DataStore; household: Household; reader: Reader | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(reader?.display_name ?? '');
  const [avatar, setAvatar] = useState<string>(reader?.avatar ?? DEFAULT_AVATAR);
  const [kind, setKind] = useState<ReaderKind>(reader?.kind ?? 'child');
  const [needsCheck, setNeedsCheck] = useState<boolean>(reader?.kind === 'child' ? reader.needs_check : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const kindId = useId();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) return setError(t.nameRequired);
    setBusy(true);
    try {
      // Turning the check off leaves reads already waiting as they are: they still wait.
      const fields = { display_name: displayName, avatar, kind, needs_check: kind === 'child' && needsCheck };
      if (reader) await store.updateReader(reader.id, fields);
      else await store.createReader({ household_id: household.id, ...fields });
      toast({ message: fmt(reader ? t.saved : t.created, { name: displayName }) });
      onClose();
    } catch (err) {
      console.error('[readers] save failed', err);
      setError(strings.bookSheet.saveError);
      setBusy(false);
    }
  };

  return (
    <Sheet title={reader ? fmt(t.editTitle, { name: reader.display_name }) : t.addTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <label htmlFor={nameId} className="field-label">
          {t.name}
        </label>
        <input
          id={nameId}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder={t.namePlaceholder}
        />
        <AvatarPicker value={avatar} onChange={setAvatar} legend={t.avatar} />
        <div className="stack">
          <p className="field-label" id={kindId}>
            {t.kindLegend}
          </p>
          <div className="chip-row chip-row--dense" role="group" aria-labelledby={kindId} aria-describedby={`${kindId}-help`}>
            {READER_KINDS.map((value) => (
              <button key={value} type="button" className="chip" aria-pressed={kind === value} onClick={() => setKind(value)}>
                {t.kinds[value]}
              </button>
            ))}
          </div>
          <p id={`${kindId}-help`} className="small muted">
            {t.kindHelp}
          </p>
        </div>
        {kind === 'child' && (
          <div className="stack">
            <label className="grownups__check">
              <input type="checkbox" role="switch" checked={needsCheck} onChange={(e) => setNeedsCheck(e.target.checked)} aria-describedby={`${kindId}-check-help`} />
              {t.needsCheck}
            </label>
            <p id={`${kindId}-check-help`} className="small muted">
              {t.needsCheckHelp}
            </p>
          </div>
        )}
        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function NewCardSheet({ reader, onClose }: { reader: Reader; onClose: () => void }) {
  const qr = useCardQr(reader.card_token);
  return (
    <Sheet title={fmt(t.newCardTitle, { name: reader.display_name })} onClose={onClose}>
      <p>{t.newCardBody}</p>
      <div className="grownups__qr">{qr && <img src={qr} alt={fmt(t.qrAlt, { name: reader.display_name })} />}</div>
      <div className="row">
        <a className="btn btn--primary" href={href(tabPath('cards', { reader: reader.id }))}>
          🖨️ {t.printCard}
        </a>
        <button type="button" className="btn" onClick={onClose}>
          {strings.common.close}
        </button>
      </div>
    </Sheet>
  );
}
