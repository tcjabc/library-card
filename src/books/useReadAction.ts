import { useCallback, useState, type MouseEvent } from 'react';
import type { DataStore, ReadEvent, Reader } from '../data';
import { fmt, strings } from '../strings';
import { confettiBurst } from '../ui/confetti';
import { useToast } from '../ui/Toast';

/**
 * "I read this!" / "Read again!" for any screen: every tap adds one read
 * event (a repeat within 10 seconds is ignored by the data layer), with
 * confetti and an Undo toast that removes that event.
 */
export function useReadAction(store: DataStore | null, reader: Reader) {
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

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

  const read = useCallback(
    (isbn: string, title: string, readBefore: boolean, click: MouseEvent<HTMLElement>) => {
      if (!store) return;
      // Measure now: in a filtered list the button may disappear once the read is saved.
      const rect = click.currentTarget.getBoundingClientRect();
      const burstAt = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      void withPending(isbn, async () => {
        const event = await store.markRead(reader.id, isbn);
        if (!event) return; // a second tap within a few seconds, ignored on purpose
        confettiBurst(burstAt);
        toast({
          message: fmt(readBefore ? strings.shelf.markedAgainToast : strings.shelf.markedToast, { title }),
          action: { label: strings.shelf.undo, onAction: () => undo(event) },
        });
      });
    },
    [store, reader.id, toast, undo, withPending],
  );

  return { read, pending, withPending };
}
