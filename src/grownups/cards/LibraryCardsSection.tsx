import { useState } from 'react';
import { libraryCardTitle } from '../../cards/makeStrip';
import type { DataStore, Household, Library, LibraryCard, Reader } from '../../data';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { useGrownUpSession } from '../useGrownUpSession';
import { LibraryCardSheet } from './LibraryCardSheet';

const t = strings.grownups.libraryCards;

type Dialog =
  | { kind: 'edit'; reader: Reader; card: LibraryCard | null }
  | { kind: 'copy'; reader: Reader; card: LibraryCard }
  | { kind: 'delete'; reader: Reader; card: LibraryCard }
  | null;

interface LibraryCardsSectionProps {
  store: DataStore;
  household: Household;
  readers: readonly Reader[];
  libraries: readonly Library[];
  /** Every reader's library cards, newest first. */
  cards: readonly LibraryCard[];
}

/** Grown-ups > Cards: each reader's library card barcodes (printed on the back of their card). */
export function LibraryCardsSection({ store, household, readers, libraries, cards }: LibraryCardsSectionProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const title = (card: LibraryCard) => libraryCardTitle(card, libraries) ?? t.untitled;

  return (
    <section className="stack card">
      <h2>{t.heading}</h2>
      <p>{t.intro}</p>
      <p className="alert">{strings.grownups.cards.matte}</p>
      <ul className="library-cards">
        {readers.map((reader) => {
          const theirs = cards.filter((c) => c.reader_id === reader.id);
          return (
            <li key={reader.id} className="library-cards__reader stack">
              <p className="reader-row__name">
                <span aria-hidden="true">{reader.avatar}</span> {reader.display_name}
              </p>
              {theirs.length === 0 ? (
                <p className="small muted">{t.noneYet}</p>
              ) : (
                <ul className="dev-list">
                  {theirs.map((card) => (
                    <li key={card.id} className="dev-list__row">
                      <div className="stack">
                        <p>{title(card)}</p>
                        <p className="small muted">
                          {t.formats[card.format]} · <span className="library-cards__value">{card.value}</span>
                        </p>
                      </div>
                      <div className="row">
                        <button type="button" className="btn btn--small" onClick={() => setDialog({ kind: 'edit', reader, card })}>
                          {t.edit}
                        </button>
                        {readers.length > 1 && (
                          <button type="button" className="btn btn--small" onClick={() => setDialog({ kind: 'copy', reader, card })}>
                            {t.copy}
                          </button>
                        )}
                        <button type="button" className="btn btn--small btn--quiet" onClick={() => setDialog({ kind: 'delete', reader, card })}>
                          {t.delete}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="row">
                <button type="button" className="btn btn--small btn--primary" onClick={() => setDialog({ kind: 'edit', reader, card: null })}>
                  {t.add}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {dialog?.kind === 'edit' && (
        <LibraryCardSheet
          key={dialog.card?.id ?? `new-${dialog.reader.id}`}
          store={store}
          household={household}
          reader={dialog.reader}
          libraries={libraries}
          card={dialog.card}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmSheet
          title={t.deleteTitle}
          confirmLabel={t.delete}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.deleteLibraryCard(dialog.card.id);
              setDialog(null);
              toast({ message: t.deleted });
            }, strings.gate.reasonDeleteLibraryCard)
          }
        >
          <p>{fmt(t.deleteBody, { title: title(dialog.card), name: dialog.reader.display_name })}</p>
        </ConfirmSheet>
      )}
      {dialog?.kind === 'copy' && (
        <CopyCardSheet
          store={store}
          card={dialog.card}
          title={title(dialog.card)}
          others={readers.filter((r) => r.id !== dialog.reader.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function CopyCardSheet({
  store,
  card,
  title,
  others,
  onClose,
}: {
  store: DataStore;
  card: LibraryCard;
  title: string;
  others: readonly Reader[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const created = await store.copyLibraryCardToReaders(card.id, [...picked]);
      toast({ message: created.length === 0 ? t.copiedNone : created.length === 1 ? t.copiedOne : fmt(t.copied, { count: created.length }) });
      onClose();
    } catch (error) {
      console.error('[library cards] copy', error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.copyTitle} onClose={onClose}>
      <div className="stack">
        <p>{t.copyIntro}</p>
        {others.length === 0 ? (
          <p className="muted">{t.copyNone}</p>
        ) : (
          <fieldset className="grownups__picker">
            <legend className="field-label">{fmt(t.copyPick, { title })}</legend>
            {others.map((r) => (
              <label key={r.id} className="grownups__check">
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span aria-hidden="true">{r.avatar}</span> {r.display_name}
              </label>
            ))}
          </fieldset>
        )}
        {failed && (
          <p className="alert alert--danger" role="alert">
            {t.saveFailed}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={busy || picked.size === 0} onClick={() => void copy()}>
            {t.copyConfirm}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
