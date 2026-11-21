import { useState } from 'react';
import { pickStickerWinner, type Book, type DataStore, type Loan, type Reader } from '../../data';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/**
 * "Scan to return": scan a library sticker; a matching active loan anywhere in
 * the household (any reader) is offered for return. With duplicates, the
 * winning loan is used. An unknown sticker says so and scanning continues.
 */
export function ReturnSheet({ store, reader, onClose }: { store: DataStore; reader: Reader; onClose: () => void }) {
  const t = strings.returning;
  const toast = useToast();
  const [found, setFound] = useState<{ loan: Loan; book: Book | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSticker = async (value: string) => {
    const match = pickStickerWinner(await store.findActiveLoansBySticker(reader.household_id, value));
    if (!match) {
      setMessage(t.unknown);
      return;
    }
    setMessage(null);
    setFound({ loan: match.winner, book: await store.getBook(match.winner.isbn) });
  };

  const confirm = async () => {
    if (!found) return;
    setBusy(true);
    const title = found.book?.title ?? strings.shelf.thisBook;
    try {
      const loanId = found.loan.id;
      await store.returnLoan(loanId);
      onClose();
      toast({
        message: fmt(strings.library.returnedToast, { title }),
        action: { label: strings.shelf.undo, onAction: () => void store.unreturnLoan(loanId) },
      });
    } catch (error) {
      console.error('[return] failed', error);
      toast({ message: strings.shelf.saveError });
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.title} onClose={onClose}>
      {!found ? (
        <div className="stack">
          <p className="kid-lead">
            <span aria-hidden="true">🏷️ </span>
            {t.intro}
          </p>
          <BookScanner mode="sticker" message={message} onSticker={(value) => void onSticker(value)} />
        </div>
      ) : (
        <div className="center-stack">
          <div className="book-summary">
            <div className="book-summary__cover">
              <BookCover title={found.book?.title ?? strings.shelf.thisBook} coverUrl={found.book?.cover_url ?? null} />
            </div>
          </div>
          <p className="kid-title">{fmt(t.confirm, { title: found.book?.title ?? strings.shelf.thisBook })}</p>
          <div className="row">
            <button type="button" className="btn btn--accent btn--big" disabled={busy} onClick={() => void confirm()}>
              {t.yes}
            </button>
            <button type="button" className="btn btn--big" disabled={busy} onClick={() => setFound(null)}>
              {t.notNow}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
