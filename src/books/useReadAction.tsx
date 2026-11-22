import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useDataQuery, type DataStore, type MarkReadOptions, type ReadEvent, type Reader } from '../data';
import { checkJourneyCompletion } from '../journeys/completion';
import { navigate } from '../router';
import { fmt, strings } from '../strings';
import { confettiBurst } from '../ui/confetti';
import { useToast } from '../ui/Toast';
import { ReadSheet } from './ReadSheet';
import { readSteps, waitingBooks } from './readFlow';

interface Asking {
  isbn: string;
  title: string;
  readBefore: boolean;
  burstAt: { x: number; y: number };
}

/**
 * "I read this!" / "Read again!" for any screen. A child first says how they read it (and, if
 * their reads need a grown-up's check, who checks it: see ReadSheet); a grown-up's own read is
 * recorded at once. Every read adds one event (a repeat within 10 seconds is ignored by the data
 * layer). A counted read gets confetti and an Undo toast; a read sent for a grown-up to check gets
 * a quiet toast with Undo, and its book waits ("⏳") until it's checked.
 *
 * After each counted read it checks the reader's journey: a finished journey is completed and its
 * celebration follows (the overlay in App). A reader with no journey gets "Pick a journey!".
 *
 * Render `sheet` somewhere on the screen; use `waiting` for the books' read buttons.
 */
export function useReadAction(store: DataStore | null, reader: Reader, options: { onRecorded?: () => void } = {}) {
  const { onRecorded } = options;
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<Asking | null>(null);
  const waitingQuery = useCallback((s: DataStore) => s.listPendingReads(reader.household_id, reader.id), [reader.household_id, reader.id]);
  const { data: pendingReads } = useDataQuery(waitingQuery, ['read_events']);
  const waiting = useMemo(() => waitingBooks(pendingReads ?? [], reader.id), [pendingReads, reader.id]);

  const withPending = useCallback(
    async (key: string, work: () => Promise<void>) => {
      setPending((p) => new Set(p).add(key));
      try {
        await work();
      } catch (error) {
        console.error('[read] update failed', error);
        toast({ message: strings.shelf.saveError });
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    },
    [toast],
  );

  /** Undo removes the reader's latest event for the book, which is the one just added. */
  const undo = useCallback(
    (event: ReadEvent) => {
      if (!store) return;
      void withPending(event.isbn, async () => {
        const removed = await store.undoLatestRead(reader.id, event.isbn);
        // Another tab added a newer read meanwhile: put that back; ours stays removed.
        if (removed && removed.id !== event.id) await store.restoreReadEvent(removed);
      });
    },
    [store, reader.id, withPending],
  );

  const record = useCallback(
    (ask: Asking, options: MarkReadOptions) => {
      if (!store) return;
      void withPending(ask.isbn, async () => {
        const event = await store.markRead(reader.id, ask.isbn, undefined, options);
        if (!event) return; // a second tap within a few seconds, ignored on purpose
        const undoAction = { label: strings.shelf.undo, onAction: () => undo(event) };
        if (event.status === 'pending') {
          // Quietly: it counts once a grown-up confirms it.
          toast({ message: strings.reads.sentToast, action: undoAction });
          return;
        }
        confettiBurst(ask.burstAt);
        const message = fmt(ask.readBefore ? strings.shelf.markedAgainToast : strings.shelf.markedToast, { title: ask.title });
        // The read is saved; a failed journey check must not look like a failed read.
        const noJourney = await journeyAfterRead(store, reader.id).catch((error: unknown) => {
          console.error('[journey] completion check failed', error);
          return false;
        });
        toast({
          message,
          action: undoAction,
          secondaryAction: noJourney ? { label: strings.journey.pickJourney, onAction: () => navigate('/journeys') } : undefined,
        });
      });
    },
    [store, reader.id, toast, undo, withPending],
  );

  const read = useCallback(
    (isbn: string, title: string, readBefore: boolean, click: MouseEvent<HTMLElement>) => {
      if (!store || waiting.has(isbn)) return;
      // Measure now: in a filtered list the button may disappear once the read is saved.
      const rect = click.currentTarget.getBoundingClientRect();
      const ask: Asking = { isbn, title, readBefore, burstAt: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
      if (readSteps(reader).length === 0) {
        record(ask, { status: 'confirmed' });
        onRecorded?.();
      } else {
        setAsking(ask);
      }
    },
    [store, reader, record, waiting, onRecorded],
  );

  const sheet: ReactNode = asking ? (
    <ReadSheet
      reader={reader}
      title={asking.title}
      onCancel={() => setAsking(null)}
      onDone={(chosen) => {
        setAsking(null);
        record(asking, chosen);
        onRecorded?.();
      }}
    />
  ) : null;

  return { read, pending, withPending, sheet, waiting };
}

/**
 * Completes the active journey if this read finished it. Returns true when
 * the reader has no journey going (and didn't just finish one, which the
 * celebration already covers).
 */
async function journeyAfterRead(store: DataStore, readerId: string): Promise<boolean> {
  if (await checkJourneyCompletion(store, readerId)) return false;
  return (await store.getActiveJourney(readerId)) === null;
}
