import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * The photo outbox: which cover photos this device has uploaded to the household's relay room (or
 * gave up on), in a small database of its own next to the main one ("<name>:sync-blobs"). Only the
 * sync adapter opens it, so the local adapter, its schema version and backups are untouched.
 *
 * A photo needs uploading when a book points at it ("cover:<sha256>"), it is on this device, and
 * its entry is missing or pending. An op that sets a cover to such a photo waits in the outbox
 * until the photo is uploaded (or has failed), so other devices never get a cover they can't fetch.
 */

export interface BlobOutboxEntry {
  hash: string;
  /** pending: still to upload (retried with backoff); uploaded: on the relay; failed: too large or room full. */
  state: 'pending' | 'uploaded' | 'failed';
  attempts: number;
  /** When a pending photo may be tried again (ms since the epoch). */
  next_at: number;
  /** Why it failed ('too_large', 'room_full'), or the last error for a pending one. */
  error: string | null;
}

interface PhotoOutboxDB extends DBSchema {
  blob_outbox: { key: string; value: BlobOutboxEntry };
}

export type PhotoOutboxDb = IDBPDatabase<PhotoOutboxDB>;

export const photoOutboxName = (dbName: string) => `${dbName}:sync-blobs`;

export function openPhotoOutbox(dbName: string): Promise<PhotoOutboxDb> {
  return openDB<PhotoOutboxDB>(photoOutboxName(dbName), 1, {
    upgrade(db) {
      db.createObjectStore('blob_outbox', { keyPath: 'hash' });
    },
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

/** Still to upload: neither on the relay nor given up on. */
export const isWaiting = (entry: BlobOutboxEntry | undefined) => !entry || entry.state === 'pending';
