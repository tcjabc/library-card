import type { PhotoCounts, SyncDataStore } from '../data';
import { PhotoCheckError, PhotoTooLargeError, openPhoto, sealPhoto } from './photos';
import { blobId } from './vendor/crypto.js';

/**
 * Cover photos between this device and the household's relay room (only in the tab that runs
 * sync). Uploads: every photo a book points at that isn't on the relay yet, once the room exists,
 * with retries and backoff; a photo too large for the relay (413) or a full room (507) is marked
 * failed and never blocks other changes. Downloads: a cover a book points at that isn't on this
 * device is fetched, opened, checked against its hash and stored; a missing or bad one is retried
 * later (backoff, capped). A deleted room (410) stops all photo traffic.
 */

export interface PhotoKeys {
  /** The relay's base URL. */
  base: string;
  roomId: string;
  token: string;
  blobKey: CryptoKey;
  blobIdKey: CryptoKey;
}

export interface PhotoSyncOptions {
  store: SyncDataStore;
  /** The room's keys, or null when photos mustn't move (sync off, household deleted). */
  keys(): Promise<PhotoKeys | null>;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  log?: Pick<Console, 'warn' | 'error'>;
  /** The relay answered 410: the household was deleted. */
  onDeleted(): void;
  /** Photos went up: changes that were waiting for them can be sent now. */
  onUploaded(): void;
  onCounts(counts: PhotoCounts): void;
}

export interface PhotoSync {
  /** Upload whatever is due now (and schedule the next retry). Never rejects. */
  kick(): Promise<void>;
  /** A cover this device doesn't have: fetch it (unless it's in backoff). */
  want(hash: string): void;
  /** No more photo traffic until reset() (deleted household, another tab took over, disposed). */
  stop(): void;
  reset(): void;
  /** Resolves once nothing is running (tests). */
  idle(): Promise<void>;
}

const UPLOAD_BASE_MS = 2000;
const UPLOAD_MAX_MS = 5 * 60_000;
const DOWNLOAD_BASE_MS = 5000;
const DOWNLOAD_MAX_MS = 60 * 60_000;

class Status extends Error {
  constructor(readonly status: number) {
    super(`The relay answered ${status}.`);
  }
}

export function createPhotoSync(options: PhotoSyncOptions): PhotoSync {
  const { store, log = console } = options;
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const timers = options.timers ?? { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as number) };

  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let retryTimer: unknown = null;
  const downloads = new Map<string, { attempts: number; next_at: number; timer: unknown }>();
  const inFlight = new Set<Promise<void>>();

  const backoff = (attempts: number, base: number, max: number) => Math.round(Math.min(max, base * 2 ** attempts) * (0.5 + random()));
  const url = (k: PhotoKeys, id?: string) => `${k.base}/v1/rooms/${k.roomId}/blobs${id ? `/${id}` : ''}`;
  const auth = (k: PhotoKeys) => ({ Authorization: `Bearer ${k.token}` });

  const deleted = () => {
    stop();
    options.onDeleted();
  };

  async function remoteIds(k: PhotoKeys): Promise<Set<string>> {
    const res = await doFetch(url(k), { headers: auth(k) });
    if (res.status === 404) return new Set(); // no room yet
    if (!res.ok) throw new Status(res.status);
    const body = (await res.json()) as { ids?: unknown };
    return new Set(Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []);
  }

  async function uploadPass(): Promise<void> {
    const k = await options.keys();
    if (!k || stopped) return;
    const due = await store.photosToUpload(now());
    let uploaded = 0;
    if (due.length) {
      let onRelay = new Set<string>();
      try {
        onRelay = await remoteIds(k);
      } catch (error) {
        if (error instanceof Status && error.status === 410) return deleted();
        // Can't list: upload anyway (the relay keeps one copy per id).
      }
      for (const { hash, blob } of due) {
        if (stopped) return;
        const id = await blobId(k.blobIdKey, hash);
        if (onRelay.has(id)) {
          await store.setPhotoState(hash, { state: 'uploaded', attempts: 0, next_at: 0, error: null });
          uploaded++;
          continue;
        }
        const previous = await store.getPhotoState(hash);
        const attempts = (previous?.attempts ?? 0) + 1;
        const retry = (error: string) =>
          store.setPhotoState(hash, { state: 'pending', attempts, next_at: now() + backoff(attempts - 1, UPLOAD_BASE_MS, UPLOAD_MAX_MS), error });
        let sealed: Uint8Array;
        try {
          sealed = await sealPhoto(k.blobKey, id, new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/jpeg');
        } catch (error) {
          if (error instanceof PhotoTooLargeError) {
            await store.setPhotoState(hash, { state: 'failed', attempts, next_at: 0, error: 'too_large' });
            continue;
          }
          throw error;
        }
        let res: Response;
        try {
          res = await doFetch(url(k, id), {
            method: 'PUT',
            headers: { ...auth(k), 'Content-Type': 'application/octet-stream' },
            body: sealed as BodyInit,
          });
        } catch {
          await retry('offline');
          continue;
        }
        await res.arrayBuffer().catch(() => undefined);
        if (res.ok) {
          await store.setPhotoState(hash, { state: 'uploaded', attempts: 0, next_at: 0, error: null });
          uploaded++;
        } else if (res.status === 413) {
          await store.setPhotoState(hash, { state: 'failed', attempts, next_at: 0, error: 'too_large' });
        } else if (res.status === 507) {
          await store.setPhotoState(hash, { state: 'failed', attempts, next_at: 0, error: 'room_full' });
        } else if (res.status === 410) {
          return deleted();
        } else {
          await retry(`http_${res.status}`);
        }
      }
    }
    if (uploaded) options.onUploaded();
    options.onCounts(await store.photoCounts());
    // The next retry, if any photo is waiting for one.
    const next = await store.nextPhotoRetryAt();
    if (next !== null && !stopped) {
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = timers.setTimeout(() => {
        retryTimer = null;
        void kick();
      }, Math.max(0, next - now()));
    }
  }

  function kick(): Promise<void> {
    if (stopped) return Promise.resolve();
    running = running.then(uploadPass).catch((error: unknown) => log.error('[photos] upload failed', error));
    return running;
  }

  async function download(hash: string): Promise<void> {
    const k = await options.keys();
    if (!k || stopped) return;
    if (await store.hasLocalPhoto(hash)) return;
    const id = await blobId(k.blobIdKey, hash);
    let res: Response;
    try {
      res = await doFetch(url(k, id), { headers: auth(k) });
    } catch {
      return later(hash);
    }
    if (res.status === 410) return deleted();
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return later(hash); // 404: not uploaded yet (or lost); try again later
    }
    try {
      const { bytes, type } = await openPhoto(k.blobKey, id, new Uint8Array(await res.arrayBuffer()), hash);
      await store.saveRemotePhoto(hash, new Blob([bytes as BlobPart], { type }));
      downloads.delete(hash);
    } catch (error) {
      if (!(error instanceof PhotoCheckError)) throw error;
      log.warn('[photos] a photo from the relay failed its check; trying again later.');
      return later(hash);
    }
  }

  /** Back off (capped) and try again by itself; showing the cover again won't fetch sooner. */
  function later(hash: string): void {
    const previous = downloads.get(hash);
    const attempts = (previous?.attempts ?? 0) + 1;
    const wait = backoff(attempts - 1, DOWNLOAD_BASE_MS, DOWNLOAD_MAX_MS);
    const timer = timers.setTimeout(() => {
      const entry = downloads.get(hash);
      if (entry) entry.timer = null;
      want(hash, true);
    }, wait);
    downloads.set(hash, { attempts, next_at: now() + wait, timer });
  }

  function want(hash: string, retrying = false): void {
    if (stopped) return;
    const state = downloads.get(hash);
    if (state && (state.timer !== null || state.next_at > now()) && !retrying) return; // backing off
    if (state?.next_at === -1) return; // in flight
    downloads.set(hash, { attempts: state?.attempts ?? 0, next_at: -1, timer: null });
    const job = download(hash)
      .catch((error: unknown) => {
        log.error('[photos] download failed', error);
        later(hash);
      })
      .finally(() => {
        inFlight.delete(job);
        const entry = downloads.get(hash);
        if (entry?.next_at === -1) downloads.delete(hash);
      });
    inFlight.add(job);
  }

  function stop(): void {
    stopped = true;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
    for (const d of downloads.values()) if (d.timer !== null) timers.clearTimeout(d.timer);
    downloads.clear();
  }

  return {
    kick,
    want: (hash) => want(hash),
    stop,
    reset() {
      stop();
      stopped = false;
    },
    async idle() {
      await running;
      while (inFlight.size) await Promise.all([...inFlight]);
      await running;
    },
  };
}
