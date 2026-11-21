import { useCallback, useId, useState, type FormEvent } from 'react';
import { useCardQr } from '../../cards/useCardQr';
import { isDataStoreError, useDataQuery, type DataStore, type DeleteReaderPreview, type Household, type Reader } from '../../data';
import { getJourney } from '../../journeys/journeys';
import { journeyProgress } from '../../journeys/progress';
import { AvatarPicker } from '../../readers/AvatarPicker';
import { DEFAULT_AVATAR } from '../../readers/avatars';
import { href } from '../../router';
import { clearActiveReader, getActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { readStats, tabPath } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
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
      const def = active ? getJourney(active.journey_id) : undefined;
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

/** Grown-ups > Readers: who reads here, how much, and their cards. */
export function ReadersTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const query = useCallback((s: DataStore) => loadReaders(s, household.id), [household.id]);
  const { data: rows } = useDataQuery(query, ['readers', 'read_events', 'reader_journeys', 'loans']);

  const askDelete = async (reader: Reader) => {
    const preview = await store.previewDeleteReader(reader.id);
    setDialog({ kind: 'delete', reader, preview });
  };

  return (
    <>
      <section className="stack card">
        <div className="row grownups__section-head">
          <h2>{fmt(t.heading, { count: rows?.length ?? 0 })}</h2>
          <button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: 'edit', reader: null })}>
            {t.add}
          </button>
        </div>
        {rows && rows.length === 0 && <p className="muted">{t.none}</p>}
        <ul className="dev-list">
          {rows?.map(({ reader, booksRead, rereads, journey, completed }) => (
            <li key={reader.id} className="dev-list__row">
              <div className="grownups-reader">
                <span className="avatar avatar--md" aria-hidden="true">
                  {reader.avatar}
                </span>
                <div className="stack grownups-reader__body">
                  <p className="grownups__item-title">{reader.display_name}</p>
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
      </section>

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
            <li>{fmt(t.deleteJourneys, { count: dialog.preview.journeys })}</li>
            <li>{fmt(t.deleteLoans, { count: dialog.preview.returnedLoans })}</li>
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) return setError(t.nameRequired);
    setBusy(true);
    try {
      if (reader) await store.updateReader(reader.id, { display_name: displayName, avatar });
      else await store.createReader({ household_id: household.id, display_name: displayName, avatar });
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
