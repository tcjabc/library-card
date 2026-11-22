import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncStore } from '../../data/sync/adapter';
import type { SyncDataStore } from '../../data/sync/types';
import { rawAll } from '../../data/testing/fixtures';
import { createPhotoSync, type PhotoKeys, type PhotoSync } from '../photoSync';
import { BUCKET_BYTES, openPhoto, sealPhoto, sha256Hex } from '../photos';
import { blobId, deriveBlobKeys, generateKey } from '../vendor/crypto.js';

// Cover photo sync (src/sync/photoSync.ts) and the sync store's photo outbox, against a fake relay.

const ISBN_A = '9780000000002';
const ISBN_B = '9780000000019';
const bytes = (n: number, seed = 1) => new Uint8Array(n).map((_, i) => (i * 31 + seed) % 256);

type Handler = (method: string, path: string, body: Uint8Array | null) => Response | Promise<Response>;

let store: SyncDataStore;
let dbName: string;
let clock: number;
let keys: PhotoKeys;
let calls: { method: string; path: string }[];
let handler: Handler;
let timers: ReturnType<typeof manualTimers>;
let events: { deleted: number; uploaded: number; counts: { waiting: number; failed: number }[] };
let photos: PhotoSync;
let keysOn: boolean;

/** Timers that run only when the test fires them, moving the clock to their time. */
function manualTimers() {
  let n = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      pending.set(++n, { fn, at: clock + ms });
      return n;
    },
    clearTimeout: (id: unknown) => void pending.delete(id as number),
    delays: () => [...pending.values()].map((t) => t.at - clock),
    async fireNext() {
      const [id, t] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      pending.delete(id);
      clock = Math.max(clock, t.at);
      t.fn();
      await photos.idle();
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  dbName = `photos-${crypto.randomUUID()}`;
  clock = 1_000_000;
  store = await createSyncStore(dbName, { now: () => clock });
  const { blobKey, blobIdKey } = await deriveBlobKeys(generateKey());
  keys = { base: 'https://relay.example', roomId: 'room', token: 'tok', blobKey, blobIdKey };
  calls = [];
  handler = (method) => (method === 'GET' ? json({ ids: [], count: 0, bytes: 0 }) : new Response('{}'));
  timers = manualTimers();
  events = { deleted: 0, uploaded: 0, counts: [] };
  keysOn = true;
  photos = createPhotoSync({
    store,
    keys: async () => (keysOn ? keys : null),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      calls.push({ method, path: url.pathname });
      const body = init?.body ? new Uint8Array(init.body as Uint8Array) : null;
      return handler(method, url.pathname, body);
    },
    now: () => clock,
    random: () => 0.5,
    timers,
    log: { warn: () => {}, error: () => {} },
    onDeleted: () => events.deleted++,
    onUploaded: () => events.uploaded++,
    onCounts: (c) => events.counts.push(c),
  });
});

afterEach(async () => {
  photos.stop();
  await photos.idle();
  await store.close();
  indexedDB.deleteDatabase(dbName);
  indexedDB.deleteDatabase(`${dbName}:sync-blobs`);
});

/** A book with a photo cover on this device; returns the photo's hash. */
async function bookWithPhoto(isbn = ISBN_A, photo = bytes(2000)): Promise<string> {
  const url = await store.saveCoverImage(new Blob([photo as BlobPart], { type: 'image/jpeg' }));
  await store.putBook({ isbn, title: 'Photo book', authors: [], cover_url: url, source: 'manual' });
  return sha256Hex(photo);
}

const puts = () => calls.filter((c) => c.method === 'PUT');
const lastCounts = () => events.counts.at(-1);
const coverOps = async () => (await store.pendingOps()).filter((op) => op.f === 'cover_url').map((op) => op.rec);

describe('uploads', () => {
  it('seals, pads and uploads a photo a book uses, under its blob id, then marks it uploaded', async () => {
    const hash = await bookWithPhoto();
    let sent: Uint8Array | null = null;
    handler = (method, _path, body) => {
      if (method === 'PUT') sent = body;
      return method === 'GET' ? json({ ids: [] }) : new Response('{}');
    };
    await photos.kick();
    const id = await blobId(keys.blobIdKey, hash);
    expect(puts()).toEqual([{ method: 'PUT', path: `/v1/rooms/room/blobs/${id}` }]);
    expect(sent!.byteLength % BUCKET_BYTES).toBe(0);
    expect((await openPhoto(keys.blobKey, id, sent!, hash)).bytes).toEqual(bytes(2000));
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'uploaded' });
    expect(events.uploaded).toBe(1);
    expect(lastCounts()).toEqual({ waiting: 0, failed: 0 });

    // Nothing left to send.
    await photos.kick();
    expect(puts()).toHaveLength(1);
  });

  it('does not send a photo the relay already has', async () => {
    const hash = await bookWithPhoto();
    const id = await blobId(keys.blobIdKey, hash);
    handler = () => json({ ids: [id] });
    await photos.kick();
    expect(puts()).toHaveLength(0);
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'uploaded' });
  });

  it('only sends photos a book uses (not catalogue covers or unused photos)', async () => {
    await store.saveCoverImage(new Blob([bytes(300, 9) as BlobPart], { type: 'image/jpeg' })); // saved, never used
    await store.putBook({ isbn: ISBN_B, title: 'Online', authors: [], cover_url: 'https://example.org/b.jpg', source: 'openlibrary' });
    await photos.kick();
    expect(calls).toHaveLength(0);
  });

  it('413 and 507 mark the photo failed, count it, and never retry it', async () => {
    const big = await bookWithPhoto(ISBN_A, bytes(2000, 1));
    const full = await bookWithPhoto(ISBN_B, bytes(2000, 2));
    const bigId = await blobId(keys.blobIdKey, big);
    handler = (method, path) => (method === 'GET' ? json({ ids: [] }) : new Response('', { status: path.endsWith(bigId) ? 413 : 507 }));
    await photos.kick();
    expect(await store.getPhotoState(big)).toMatchObject({ state: 'failed', error: 'too_large' });
    expect(await store.getPhotoState(full)).toMatchObject({ state: 'failed', error: 'room_full' });
    expect(lastCounts()).toEqual({ waiting: 0, failed: 2 });
    expect(timers.delays()).toEqual([]);
    await photos.kick();
    expect(puts()).toHaveLength(2);
  });

  it('retries other failures with growing backoff, then succeeds', async () => {
    const hash = await bookWithPhoto();
    let failures = 3;
    handler = (method) => {
      if (method === 'GET') return json({ ids: [] });
      if (failures-- === 3) return Promise.reject(new TypeError('fetch failed')); // offline
      return failures >= 0 ? new Response('', { status: 503 }) : new Response('{}');
    };
    await photos.kick();
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'pending', attempts: 1, error: 'offline' });
    expect(lastCounts()).toEqual({ waiting: 1, failed: 0 });
    expect(timers.delays()).toEqual([2000]);

    // Kicking again before the retry time sends nothing.
    await photos.kick();
    expect(puts()).toHaveLength(1);

    await timers.fireNext();
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'pending', attempts: 2, error: 'http_503' });
    expect(timers.delays()).toEqual([4000]);
    await timers.fireNext();
    expect(timers.delays()).toEqual([8000]);
    await timers.fireNext();
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'uploaded' });
    expect(puts()).toHaveLength(4);
    expect(timers.delays()).toEqual([]);
  });

  it('caps the backoff at 5 minutes', async () => {
    const hash = await bookWithPhoto();
    handler = (method) => (method === 'GET' ? json({ ids: [] }) : new Response('', { status: 500 }));
    await photos.kick();
    for (let i = 0; i < 12; i++) await timers.fireNext();
    expect(await store.getPhotoState(hash)).toMatchObject({ attempts: 13 });
    expect(timers.delays()).toEqual([300_000]);
  });

  it('410 stops all photo traffic', async () => {
    await bookWithPhoto();
    handler = () => new Response('', { status: 410 });
    await photos.kick();
    expect(events.deleted).toBe(1);
    const before = calls.length;
    await bookWithPhoto(ISBN_B, bytes(100, 5));
    await photos.kick();
    photos.want('a'.repeat(64));
    await photos.idle();
    expect(calls.length).toBe(before);
    expect(timers.delays()).toEqual([]);
  });

  it('sends nothing while there are no keys (sync off, or another tab runs sync)', async () => {
    keysOn = false;
    await bookWithPhoto();
    await photos.kick();
    photos.want('a'.repeat(64));
    await photos.idle();
    expect(calls).toHaveLength(0);
  });
});

describe('downloads', () => {
  /** On this device a book points at a photo it doesn't have (it came from another device). */
  async function remoteBook(photo = bytes(1500, 7)) {
    const hash = await sha256Hex(photo);
    await store.putBook({ isbn: ISBN_A, title: 'From the other device', authors: [], cover_url: `cover:${hash}`, source: 'manual' });
    const id = await blobId(keys.blobIdKey, hash);
    return { hash, id, sealed: await sealPhoto(keys.blobKey, id, photo, 'image/jpeg'), photo };
  }

  it('a missing cover is reported, fetched, checked, stored and then shown', async () => {
    const { hash, id, sealed, photo } = await remoteBook();
    const missing: string[] = [];
    const off = store.onMissingPhoto((h) => missing.push(h));
    expect((await store.getBook(ISBN_A))?.cover_url).toBeNull();
    expect(missing).toEqual([hash]);
    off();

    handler = (_m, path) => (path.endsWith(id) ? new Response(sealed as BodyInit) : new Response('', { status: 404 }));
    photos.want(hash);
    await photos.idle();
    expect(await store.hasLocalPhoto(hash)).toBe(true);
    const shown = (await store.getBook(ISBN_A))?.cover_url;
    expect(shown).toMatch(/^blob:/);
    expect(new Uint8Array(await (await fetch(shown!)).arrayBuffer())).toEqual(photo);
    // Fetched photos count as on the relay: never uploaded back.
    expect(await store.getPhotoState(hash)).toMatchObject({ state: 'uploaded' });
    await photos.kick();
    expect(puts()).toHaveLength(0);
  });

  it('404 shows no cover and retries later with backoff; asking again meanwhile fetches nothing', async () => {
    const { hash, sealed } = await remoteBook();
    let ready = false;
    handler = () => (ready ? new Response(sealed as BodyInit) : new Response('', { status: 404 }));
    photos.want(hash);
    await photos.idle();
    expect(timers.delays()).toEqual([5000]);
    photos.want(hash);
    photos.want(hash);
    await photos.idle();
    expect(calls).toHaveLength(1);

    await timers.fireNext();
    expect(timers.delays()).toEqual([10_000]);
    ready = true;
    await timers.fireNext();
    expect(await store.hasLocalPhoto(hash)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(timers.delays()).toEqual([]);
  });

  it('a photo that fails its hash check is not stored and is retried later', async () => {
    const { hash, id } = await remoteBook();
    const wrong = await sealPhoto(keys.blobKey, id, bytes(1500, 8), 'image/jpeg'); // right id, other photo
    handler = () => new Response(wrong as BodyInit);
    photos.want(hash);
    await photos.idle();
    expect(await store.hasLocalPhoto(hash)).toBe(false);
    expect(timers.delays()).toEqual([5000]);
  });

  it('caps the download backoff at an hour', async () => {
    const { hash } = await remoteBook();
    handler = () => new Response('', { status: 404 });
    photos.want(hash);
    await photos.idle();
    for (let i = 0; i < 12; i++) await timers.fireNext();
    expect(timers.delays()).toEqual([3_600_000]);
  });

  it('saving a book whose photo hasn’t arrived keeps its cover for the household', async () => {
    const { hash } = await remoteBook();
    const shown = await store.getBook(ISBN_A);
    expect(shown?.cover_url).toBeNull();
    await store.putBook({ ...shown!, title: 'Renamed' });
    const rawBook = async () => (await rawAll<{ isbn: string; title: string; cover_url: string | null }>(dbName, 'books')).find((b) => b.isbn === ISBN_A);
    expect(await rawBook()).toMatchObject({ title: 'Renamed', cover_url: `cover:${hash}` });
    // Once the photo is here, removing the cover works as usual.
    await store.saveRemotePhoto(hash, new Blob([bytes(1500, 7) as BlobPart], { type: 'image/jpeg' }));
    await store.putBook({ ...shown!, title: 'Renamed', cover_url: null });
    expect((await rawBook())?.cover_url).toBeNull();
  });
});

describe('the sync store: photos before the changes that use them', () => {
  it('holds a book’s cover change until its photo is uploaded, never its other fields', async () => {
    await store.enableSync(generateKey());
    const hash = await bookWithPhoto();
    const ops = await store.pendingOps();
    expect(ops.some((op) => op.rec === `books:${ISBN_A}` && op.f === 'title')).toBe(true);
    expect(await coverOps()).toEqual([]);
    expect(await store.pendingCount()).toBeGreaterThan(ops.length - 1);

    await store.setPhotoState(hash, { state: 'pending', attempts: 1, next_at: clock + 1000, error: 'offline' });
    expect(await coverOps()).toEqual([]);
    await store.setPhotoState(hash, { state: 'uploaded', attempts: 0, next_at: 0, error: null });
    expect(await coverOps()).toEqual([`books:${ISBN_A}`]);
  });

  it('a failed photo never blocks: its cover change goes out', async () => {
    await store.enableSync(generateKey());
    const hash = await bookWithPhoto();
    await store.setPhotoState(hash, { state: 'failed', attempts: 1, next_at: 0, error: 'too_large' });
    expect(await coverOps()).toEqual([`books:${ISBN_A}`]);
  });

  it('a catalogue cover URL is never held', async () => {
    await store.enableSync(generateKey());
    await store.putBook({ isbn: ISBN_B, title: 'Online', authors: [], cover_url: 'https://example.org/b.jpg', source: 'openlibrary' });
    expect(await coverOps()).toEqual([`books:${ISBN_B}`]);
  });

  it('turning sync on queues every existing photo again; resetting the device clears the queue', async () => {
    const hash = await bookWithPhoto();
    await store.setPhotoState(hash, { state: 'uploaded', attempts: 0, next_at: 0, error: null });
    await store.enableSync(generateKey());
    expect(await store.getPhotoState(hash)).toBeNull();
    expect(await store.photoCounts()).toEqual({ waiting: 1, failed: 0 });
    expect((await store.photosToUpload(clock)).map((p) => p.hash)).toEqual([hash]);

    await store.setPhotoState(hash, { state: 'failed', attempts: 1, next_at: 0, error: 'room_full' });
    await store.resetDevice();
    expect(await store.getPhotoState(hash)).toBeNull();
  });

  it('replacing with the household’s data clears the queue', async () => {
    await store.enableSync(generateKey());
    const hash = await bookWithPhoto();
    await store.setPhotoState(hash, { state: 'failed', attempts: 1, next_at: 0, error: 'room_full' });
    await store.replaceWithRemote([], 0);
    expect(await store.getPhotoState(hash)).toBeNull();
  });
});
