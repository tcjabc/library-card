// Node tests for Library Card's changes to the relay rules (relay/src/room-logic.js): auth before
// the rate limit, a separate failed-auth bucket, deleting a room, photos (blobs) and their limits,
// routes and size-limited body reading. No Cloudflare runtime needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/room-logic.js';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const TOKEN = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);
const ROOM = '0123456789abcdef0123456789abcdef';
const ID = 'b'.repeat(43);
const ID2 = 'c'.repeat(43);
const env = (id, wall = NOW) => ({ id, wall, c: Buffer.from(`sealed-${id}`).toString('base64') });
const body = (envelopes) => JSON.stringify({ envelopes });
const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);

function room(limits) {
  let t = NOW;
  const store = R.memoryStore();
  const blobs = R.memoryBlobs();
  const core = new R.RoomCore(store, { now: () => t, limits, blobs, roomId: ROOM });
  return { core, store, blobs, advance: (ms) => { t += ms; } };
}

const claimed = async (limits) => {
  const r = room(limits);
  assert.equal((await r.core.push({ token: TOKEN, bodyText: body([env('first')]) })).status, 200);
  return r;
};

/* ------------------------------------------------------------------ Order of checks */

test('the body is only read after the token and the rate limit pass', async () => {
  const { core } = await claimed({ rateCapacity: 2, rateRefillPerSec: 0.001 });
  let reads = 0;
  const readBody = async () => { reads++; return body([env('x')]); };
  assert.equal((await core.push({ token: OTHER, readBody })).status, 401, 'wrong token');
  assert.equal((await core.push({ token: 'short', readBody })).status, 401, 'malformed token');
  assert.equal(reads, 0, 'never read for a bad token');
  assert.equal((await core.push({ token: TOKEN, readBody })).status, 200);
  assert.equal(reads, 1);
  // The first push and this one used up the bucket of 2.
  assert.equal((await core.push({ token: TOKEN, readBody })).status, 429);
  assert.equal(reads, 1, 'never read when rate-limited');
});

test('wrong tokens use their own small bucket and can never drain the room\'s', async () => {
  const { core } = await claimed({ rateCapacity: 5, failCapacity: 3, failRefillPerSec: 0.1 });
  const statuses = [];
  for (let i = 0; i < 20; i++) statuses.push((await core.pull({ token: OTHER })).status);
  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
  assert.ok(statuses.slice(3).every((s) => s === 429), 'then 429 for guesses');
  // The real token still has its whole bucket (5, minus the first push).
  for (let i = 0; i < 4; i++) assert.equal((await core.pull({ token: TOKEN })).status, 200, `real request ${i}`);
  assert.equal((await core.pull({ token: TOKEN })).status, 429);
});

test('the failed-auth bucket refills over time and says when', async () => {
  const { core, advance } = await claimed({ failCapacity: 1, failRefillPerSec: 0.1 });
  assert.equal((await core.pull({ token: OTHER })).status, 401);
  const r = await core.pull({ token: OTHER });
  assert.deepEqual([r.status, r.headers['Retry-After']], [429, '10']);
  advance(10_000);
  assert.equal((await core.pull({ token: OTHER })).status, 401);
});

test('a malformed first push claims nothing; a valid one claims the room', async () => {
  const { core, store } = room();
  assert.equal((await core.push({ token: TOKEN, bodyText: '{' })).status, 400);
  assert.equal(store.exists(), false);
  assert.equal((await core.push({ token: OTHER, bodyText: body([env('a')]) })).status, 200, 'first valid push claims');
  assert.equal(store.tokenHash(), await R.hashToken(OTHER));
  assert.equal((await core.push({ token: TOKEN, bodyText: body([env('b')]) })).status, 401);
});

test('two first pushes at once: the first to finish claims, the other is refused', async () => {
  const { core } = room();
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const a = core.push({ token: TOKEN, readBody: async () => { await slow; return body([env('a')]); } });
  const b = await core.push({ token: OTHER, bodyText: body([env('b')]) });
  assert.equal(b.status, 200, 'OTHER finished first and claimed');
  release();
  assert.equal((await a).status, 401, 'TOKEN lost the race: nothing stored');
  assert.deepEqual((await core.pull({ token: OTHER })).body.entries.map((e) => e.id), ['b']);
});

test('pushing the same ops twice stores them once', async () => {
  const { core, store } = room();
  const ops = [env('op-1'), env('op-2'), env('op-3')];
  const first = await core.push({ token: TOKEN, bodyText: body(ops) });
  const second = await core.push({ token: TOKEN, bodyText: body(ops) });
  assert.deepEqual([first.body.accepted, second.body.accepted, second.body.head], [3, 0, 3]);
  assert.equal(store.size, 3);
});

test('a push body that passes the size limit while being read is 413', async () => {
  const { core } = await claimed();
  const r = await core.push({ token: TOKEN, readBody: async () => { throw new R.TooLarge(); } });
  assert.deepEqual([r.status, r.body.error], [413, 'too_large']);
});

/* ------------------------------------------------------------------ Deleting a room */

test('deleting a room: wrong token refused, then the log and photos go and every request gets 410', async () => {
  const { core, store, blobs } = await claimed();
  await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(10) });
  assert.equal(blobs.size, 1);
  assert.equal((await core.deleteRoom({ token: OTHER })).status, 401, 'only the room token deletes');
  assert.equal((await core.deleteRoom({ token: 'short' })).status, 401);
  const r = await core.deleteRoom({ token: TOKEN });
  assert.deepEqual([r.status, r.body], [200, { deleted: true }]);
  assert.equal(store.head(), 0, 'log gone');
  assert.equal(blobs.size, 0, 'photos gone from the bucket');
  assert.equal(store.tokenHash(), await R.hashToken(TOKEN), 'the marker keeps the token hash');
  const later = [
    await core.push({ token: TOKEN, bodyText: body([env('again')]) }),
    await core.push({ token: OTHER, bodyText: body([env('claim')]) }),
    await core.pull({ token: TOKEN }),
    await core.live({ token: TOKEN }),
    await core.listBlobs({ token: TOKEN }),
    await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(1) }),
    await core.getBlob({ token: TOKEN, id: ID }),
    await core.deleteBlob({ token: TOKEN, id: ID }),
    await core.deleteRoom({ token: TOKEN }),
  ];
  assert.deepEqual(later.map((x) => x.status), [410, 410, 410, 410, 410, 410, 410, 410, 410]);
  assert.equal(later[0].body.error, 'room_deleted');
  assert.equal(store.head(), 0, 'nothing was recreated, not even by a first-push claim');
  assert.equal(blobs.size, 0);
});

test('repeating the delete with the right token clears photos left behind', async () => {
  const { core, blobs } = await claimed();
  await core.deleteRoom({ token: TOKEN });
  await blobs.put(R.blobKey(ROOM, ID), bytes(3)); // as if a bucket call had failed the first time
  assert.equal((await core.deleteRoom({ token: OTHER })).status, 410);
  assert.equal(blobs.size, 1, 'a wrong token clears nothing');
  assert.equal((await core.deleteRoom({ token: TOKEN })).status, 410);
  assert.equal(blobs.size, 0);
});

test('deleting a room that was never claimed is 404, and claims nothing', async () => {
  const { core, store } = room();
  assert.equal((await core.deleteRoom({ token: TOKEN })).status, 404);
  assert.equal(store.exists(), false);
});

test('a room deleted while a push body was read stores nothing', async () => {
  const { core, store } = await claimed();
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const p = core.push({ token: TOKEN, readBody: async () => { await slow; return body([env('late')]); } });
  await core.deleteRoom({ token: TOKEN });
  release();
  assert.equal((await p).status, 410);
  assert.equal(store.head(), 0);
});

/* ------------------------------------------------------------------ Photos */

test('photos: put, get, list and delete, stored under "<room>/<id>"', async () => {
  const { core, blobs } = await claimed();
  const put = await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(100, 1) });
  assert.deepEqual([put.status, put.body], [200, { id: ID, size: 100 }]);
  await core.putBlob({ token: TOKEN, id: ID2, readBytes: async () => bytes(50, 2) });
  assert.deepEqual(await blobs.list(`${ROOM}/`), [`${ROOM}/${ID}`, `${ROOM}/${ID2}`]);
  const got = await core.getBlob({ token: TOKEN, id: ID });
  assert.deepEqual([got.status, got.bytes.length, got.bytes[0]], [200, 100, 1]);
  assert.deepEqual((await core.listBlobs({ token: TOKEN })).body, { ids: [ID, ID2], count: 2, bytes: 150 });
  assert.equal((await core.deleteBlob({ token: TOKEN, id: ID })).status, 204);
  assert.equal((await core.deleteBlob({ token: TOKEN, id: ID })).status, 404);
  assert.equal((await core.getBlob({ token: TOKEN, id: ID })).status, 404);
  assert.deepEqual((await core.listBlobs({ token: TOKEN })).body, { ids: [ID2], count: 1, bytes: 50 });
  // Replacing a photo keeps one entry.
  await core.putBlob({ token: TOKEN, id: ID2, readBytes: async () => bytes(70) });
  assert.deepEqual((await core.listBlobs({ token: TOKEN })).body, { ids: [ID2], count: 1, bytes: 70 });
});

test('photos need the room token and an existing room, and a valid id', async () => {
  const fresh = room();
  assert.equal((await fresh.core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(1) })).status, 404, 'no room yet: photos never claim one');
  const { core } = await claimed();
  for (const call of [
    core.putBlob({ token: OTHER, id: ID, readBytes: async () => bytes(1) }),
    core.getBlob({ token: OTHER, id: ID }),
    core.listBlobs({ token: OTHER }),
    core.deleteBlob({ token: OTHER, id: ID }),
  ]) assert.equal((await call).status, 401);
  for (const bad of ['short', `${ID}x`, 'b'.repeat(42) + '+', '../x']) {
    assert.equal((await core.getBlob({ token: TOKEN, id: bad })).status, 400, bad);
  }
  assert.equal((await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(0) })).status, 400, 'empty photo');
});

test('a photo over 512 KB is 413', async () => {
  const { core } = await claimed();
  assert.equal(R.LIMITS.maxBlobBytes, 512 * 1024);
  const over = await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(512 * 1024 + 1) });
  assert.deepEqual([over.status, over.body.error], [413, 'too_large']);
  const streamed = await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => { throw new R.TooLarge(); } });
  assert.equal(streamed.status, 413);
  assert.equal((await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(512 * 1024) })).status, 200, 'exactly 512 KB is fine');
});

test('per-room photo quota: count and total size give 507', async () => {
  assert.deepEqual([R.LIMITS.maxBlobsPerRoom, R.LIMITS.maxBlobBytesPerRoom], [2_000, 200 * 1024 * 1024]);
  const byCount = await claimed({ maxBlobsPerRoom: 2 });
  await byCount.core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(1) });
  await byCount.core.putBlob({ token: TOKEN, id: ID2, readBytes: async () => bytes(1) });
  const third = await byCount.core.putBlob({ token: TOKEN, id: 'd'.repeat(43), readBytes: async () => bytes(1) });
  assert.deepEqual([third.status, third.body.error], [507, 'blobs_full']);
  assert.equal((await byCount.core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(2) })).status, 200, 'replacing one still fits');

  const bySize = await claimed({ maxBlobBytesPerRoom: 100 });
  await bySize.core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(60) });
  assert.equal((await bySize.core.putBlob({ token: TOKEN, id: ID2, readBytes: async () => bytes(41) })).status, 507);
  assert.equal((await bySize.core.putBlob({ token: TOKEN, id: ID2, readBytes: async () => bytes(40) })).status, 200, 'exactly at the quota');
  assert.equal((await bySize.core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(60) })).status, 200, 'a replacement counts its old size out');
  assert.equal(bySize.blobs.size, 2, 'refused photos never reached the bucket');
});

test('a failed bucket write gives back the reserved space', async () => {
  const { core, store, blobs } = await claimed();
  blobs.put = async () => { throw new Error('bucket down'); };
  await assert.rejects(core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(10) }), /bucket down/);
  assert.deepEqual(store.blobTotals(), { count: 0, bytes: 0 });
});

test('photo reads have their own bucket: heavy downloads never use up the push allowance', async () => {
  assert.deepEqual([R.LIMITS.readCapacity, R.LIMITS.readRefillPerSec], [300, 40]);
  const { core, advance } = await claimed({ rateCapacity: 3, rateRefillPerSec: 0.001, readCapacity: 5, readRefillPerSec: 1 });
  await core.putBlob({ token: TOKEN, id: ID, readBytes: async () => bytes(4) }); // room bucket: 2 of 3 used
  const reads = [];
  for (let i = 0; i < 8; i++) reads.push((await core.getBlob({ token: TOKEN, id: ID })).status);
  reads.push((await core.listBlobs({ token: TOKEN })).status);
  assert.deepEqual(reads, [200, 200, 200, 200, 200, 429, 429, 429, 429], 'reads stop at their own limit');
  assert.equal((await core.push({ token: TOKEN, bodyText: body([env('after-reads')]) })).status, 200, 'the push allowance is untouched');
  assert.equal((await core.push({ token: TOKEN, bodyText: body([env('over')]) })).status, 429, 'writes keep the room bucket');
  advance(1000);
  assert.equal((await core.getBlob({ token: TOKEN, id: ID })).status, 200, 'the read bucket refills on its own');
});

test('the default read bucket restores 2,000 photos in about a minute', () => {
  const { readCapacity, readRefillPerSec, maxBlobsPerRoom } = R.LIMITS;
  const seconds = (maxBlobsPerRoom - readCapacity) / readRefillPerSec;
  assert.ok(seconds <= 60, `${seconds} s`);
});

/* ------------------------------------------------------------------ Routes and bodies */

test('routes: every endpoint, method and id check', () => {
  const at = (p) => `/v1/rooms/${ROOM}${p}`;
  const cases = [
    [at(''), 'DELETE', { roomId: ROOM, action: 'delete' }],
    [at('/push'), 'POST', { roomId: ROOM, action: 'push' }],
    [at('/pull'), 'GET', { roomId: ROOM, action: 'pull' }],
    [at('/live'), 'GET', { roomId: ROOM, action: 'live' }],
    [at('/blobs'), 'GET', { roomId: ROOM, action: 'listBlobs' }],
    [at(`/blobs/${ID}`), 'PUT', { roomId: ROOM, action: 'putBlob', blobId: ID }],
    [at(`/blobs/${ID}`), 'GET', { roomId: ROOM, action: 'getBlob', blobId: ID }],
    [at(`/blobs/${ID}`), 'DELETE', { roomId: ROOM, action: 'deleteBlob', blobId: ID }],
  ];
  for (const [path, method, expected] of cases) assert.deepEqual(R.parseRoute(path, method), expected, `${method} ${path}`);
  const errors = [
    ['/v1/rooms', 'GET', 404],
    [at('/nope'), 'GET', 404],
    [at('/push/x'), 'POST', 404],
    ['/v1/rooms/NOTHEX/push', 'POST', 400],
    [at('/push'), 'GET', 405],
    [at(''), 'GET', 405],
    [at('/blobs'), 'PUT', 405],
    [at('/blobs/short'), 'GET', 400],
  ];
  for (const [path, method, status] of errors) assert.equal(R.parseRoute(path, method).reply?.status, status, `${method} ${path}`);
  assert.equal(R.parseRoute(at('/push'), 'GET').reply.headers.Allow, 'POST');
});

test('readLimited reads a stream, and stops as soon as it passes the limit', async () => {
  const stream = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
  assert.deepEqual([...(await R.readLimited(stream([bytes(3, 1), bytes(2, 2)]), 5))], [1, 1, 1, 2, 2]);
  await assert.rejects(R.readLimited(stream([bytes(3), bytes(3)]), 5), R.TooLarge);
  assert.equal((await R.readLimited(null, 5)).length, 0);
});

test('the WebSocket subprotocol is library-card-sync.v1', () => {
  assert.equal(R.PROTOCOL, 'library-card-sync.v1');
  assert.equal(R.protocolToken(`peek-sync.v1, bearer.${TOKEN}`), null, "Peek Budget's protocol is not accepted");
});
