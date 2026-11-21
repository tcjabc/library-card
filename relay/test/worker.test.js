// End-to-end tests for the relay Worker, its Durable Object (SQLite) and R2 bucket, run locally in
// workerd through Wrangler's test harness, straight from wrangler.toml: no Cloudflare account and no
// network. They also check the committed config.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const root = fileURLToPath(new URL('..', import.meta.url));
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const value = (re) => {
  const m = re.exec(toml);
  assert.ok(m, `wrangler.toml has ${re}`);
  return m[1];
};
const CONFIG = {
  name: value(/^name = "([^"]+)"/m),
  compatibilityDate: value(/^compatibility_date = "([^"]+)"/m),
  origins: value(/^ALLOWED_ORIGINS = "([^"]+)"/m),
  doBinding: value(/\[\[durable_objects\.bindings\]\]\s*name = "([^"]+)"/),
  doClass: value(/\[\[durable_objects\.bindings\]\]\s*name = "[^"]+"\s*class_name = "([^"]+)"/),
  migrationTag: value(/\[\[migrations\]\]\s*tag = "([^"]+)"/),
  sqliteClass: value(/new_sqlite_classes = \["([^"]+)"\]/),
  r2Binding: value(/\[\[r2_buckets\]\]\s*binding = "([^"]+)"/),
  r2Bucket: value(/\[\[r2_buckets\]\]\s*binding = "[^"]+"\s*bucket_name = "([^"]+)"/),
};

const BASE = 'http://relay.test';
const TOKEN = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);
const PROTOCOL = 'library-card-sync.v1';
const WALL = Date.now();
const auth = (token = TOKEN) => ({ Authorization: `Bearer ${token}` });
const env = (id) => ({ id, wall: WALL, c: Buffer.from(`sealed-${id}`).toString('base64') });

let mf;
let rooms = 0;
/** A new room id for each test, so tests don't share state. */
const newRoom = () => (rooms++).toString(16).padStart(32, 'f');
const url = (room, path = '') => `${BASE}/v1/rooms/${room}${path}`;

function call(room, path, { method = 'GET', token = TOKEN, body, headers = {}, ...rest } = {}) {
  return mf.dispatchFetch(url(room, path), {
    method,
    headers: { ...(token ? auth(token) : {}), ...headers },
    body,
    ...rest,
  });
}
const push = (room, envelopes, token) => call(room, '/push', { method: 'POST', token, body: JSON.stringify({ envelopes }), headers: { 'Content-Type': 'application/json' } });
const pull = (room, query = '', token) => call(room, `/pull${query}`, { token });
const status = async (resPromise) => {
  const res = await resPromise;
  await res.arrayBuffer();
  return res.status;
};

/**
 * A live connection the way the app (a browser) makes it: Node's WebSocket client over a real socket
 * to the local server, offering the two subprotocols. Resolves once open, with a message queue.
 */
function connect(room, { token = TOKEN, query = '' } = {}) {
  const ws = new WebSocket(`${baseUrl.href.replace(/^http/, 'ws')}v1/rooms/${room}/live${query}`, [PROTOCOL, `bearer.${token}`]);
  const messages = [];
  const waiters = [];
  const closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e)));
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const w = waiters.shift();
    if (w) w(msg); else messages.push(msg);
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({
      ws,
      next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise((r) => waiters.push(r))),
      closed,
    }));
    ws.addEventListener('error', () => reject(new Error('WebSocket refused')));
  });
}

/**
 * The HTTP status a WebSocket upgrade gets (101 when accepted). Browsers hide it, so this is a plain
 * upgrade request over a real socket.
 */
function upgradeStatus(room, protocols) {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(`v1/rooms/${room}/live`, baseUrl), {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Protocol': protocols,
      },
    });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('error', reject);
  });
}

/** The R2 bucket as the Worker sees it, to check what is (and isn't) stored. */
const bucket = async () => (await server.getWorker().getEnv())[CONFIG.r2Binding];

let server;
let baseUrl;
before(async () => {
  server = createTestHarness({ root, workers: [{ configPath: 'wrangler.toml' }] });
  baseUrl = (await server.listen()).url;
  // The test harness's fetch, under the name the tests use.
  mf = { dispatchFetch: (input, init) => server.fetch(input, init) };
});

after(async () => {
  await server?.close();
});

test('wrangler.toml: Library Card names, its own migration, R2 and localhost-only origins', () => {
  assert.deepEqual(CONFIG, {
    name: 'library-card-relay',
    compatibilityDate: CONFIG.compatibilityDate,
    origins: 'http://localhost:*,https://localhost:*',
    doBinding: 'ROOMS',
    doClass: 'LibraryRoom',
    migrationTag: 'library-card-v1',
    sqliteClass: 'LibraryRoom',
    r2Binding: 'BLOBS',
    r2Bucket: 'library-card-blobs',
  });
  assert.match(toml, /^keep_vars = true$/m, 'deploys keep dashboard variables such as the real ALLOWED_ORIGINS');
  assert.doesNotMatch(toml,/github\.io|tcjabc|peek-budget|peek-sync|"Room"/i, 'no GitHub handle, real origin or Peek names committed');
});

test('health check and unknown endpoints', async () => {
  const health = await mf.dispatchFetch(`${BASE}/v1/health`);
  assert.deepEqual([health.status, await health.json()], [200, { ok: true }]);
  const missing = await mf.dispatchFetch(`${BASE}/nope`);
  assert.deepEqual([missing.status, (await missing.json()).error], [404, 'not_found']);
  assert.equal(await status(mf.dispatchFetch(`${BASE}/v1/rooms/NOTHEX/pull`)), 400);
  assert.equal(await status(mf.dispatchFetch(url(newRoom(), '/push'))), 405);
  assert.equal(await status(call(newRoom(), '/live')), 426, '/live needs a WebSocket upgrade');
});

test('push and pull with cursors', async () => {
  const room = newRoom();
  const first = await push(room, [env('a'), env('b'), env('c')]);
  assert.deepEqual([first.status, await first.json()], [200, { head: 3, accepted: 3, rejected: [] }]);
  await (await push(room, [env('d'), env('e')])).arrayBuffer();
  const page1 = await (await pull(room, '?after=0&limit=2')).json();
  assert.deepEqual([page1.entries.map((e) => [e.seq, e.id]), page1.head], [[[1, 'a'], [2, 'b']], 5]);
  const page2 = await (await pull(room, `?after=${page1.entries.at(-1).seq}&limit=2`)).json();
  assert.deepEqual(page2.entries.map((e) => e.seq), [3, 4]);
  const page3 = await (await pull(room, '?after=4')).json();
  assert.deepEqual(page3.entries.map((e) => e.id), ['e']);
  assert.equal((await (await pull(room, '?after=5')).json()).entries.length, 0);
  assert.deepEqual(Object.keys(page1.entries[0]), ['seq', 'id', 'wall', 'c']);
});

test('pushing the same ops twice stores them once', async () => {
  const room = newRoom();
  const ops = [env('op-1'), env('op-2'), env('op-3')];
  assert.equal((await (await push(room, ops)).json()).accepted, 3);
  const again = await (await push(room, ops)).json();
  assert.deepEqual([again.accepted, again.head], [0, 3]);
  assert.equal((await (await pull(room)).json()).entries.length, 3);
});

test('the first push claims the room; a wrong token is rejected; unknown rooms are 404', async () => {
  const room = newRoom();
  assert.equal(await status(pull(room)), 404, 'pull creates nothing');
  assert.equal(await status(push(room, [env('a')])), 200);
  for (const res of [push(room, [env('x')], OTHER), pull(room, '', OTHER), call(room, '/blobs', { token: OTHER })]) {
    assert.equal(await status(res), 401);
  }
  assert.equal(await status(pull(room, '', 'short')), 401, 'malformed token');
  assert.equal(await status(pull(room, '', null)), 401, 'no token');
  const data = await (await pull(room)).json();
  assert.deepEqual(data.entries.map((e) => e.id), ['a'], 'the rejected push stored nothing');
});

test('auth happens before rate limiting: wrong tokens can\'t use up the real token\'s bucket', async () => {
  const room = newRoom();
  assert.equal(await status(push(room, [env('a')])), 200);
  const wrong = [];
  for (let i = 0; i < 150; i++) wrong.push(await status(pull(room, '', OTHER)));
  assert.equal(wrong.filter((s) => s === 401).length, 10, 'the failed-auth bucket: 10 guesses');
  assert.ok(wrong.slice(10).every((s) => s === 429), 'then 429');
  // 150 guesses later, the real token still has (almost) its whole bucket of 120.
  const real = [];
  for (let i = 0; i < 100; i++) real.push(await status(pull(room)));
  assert.ok(real.every((s) => s === 200), `real requests all succeed (${real.filter((s) => s !== 200).length} failed)`);
});

test('photos: put, get, list and delete', async () => {
  const room = newRoom();
  await (await push(room, [env('a')])).arrayBuffer();
  const id = 'Q'.repeat(43);
  const photo = new Uint8Array([1, 2, 3, 250, 251, 252]);
  const put = await call(room, `/blobs/${id}`, { method: 'PUT', body: photo, headers: { 'Content-Type': 'application/octet-stream' } });
  assert.deepEqual([put.status, await put.json()], [200, { id, size: 6 }]);
  const got = await call(room, `/blobs/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('Content-Type'), 'application/octet-stream');
  assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [...photo]);
  const listed = await (await call(room, '/blobs')).json();
  assert.deepEqual(listed, { ids: [id], count: 1, bytes: 6 });
  // Stored under "<room>/<id>" in R2.
  const r2 = await bucket();
  assert.deepEqual((await r2.list({ prefix: `${room}/` })).objects.map((o) => o.key), [`${room}/${id}`]);
  assert.equal(await status(call(room, `/blobs/${id}`, { method: 'DELETE' })), 204);
  assert.equal(await status(call(room, `/blobs/${id}`)), 404);
  assert.equal((await r2.list({ prefix: `${room}/` })).objects.length, 0);
  assert.equal(await status(call(room, '/blobs/not-an-id')), 400, 'bad id');
  assert.equal(await status(call(room, `/blobs/${id}`, { token: OTHER })), 401);
});

test('heavy photo downloads don\'t use up the push allowance', async () => {
  const room = newRoom();
  assert.equal(await status(push(room, [env('a')])), 200);
  const id = 'U'.repeat(43);
  assert.equal(await status(call(room, `/blobs/${id}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })), 200);
  // 200 downloads and lists: more than the room's whole bucket of 120.
  const reads = [];
  for (let i = 0; i < 200; i++) reads.push(await status(i % 10 ? call(room, `/blobs/${id}`) : call(room, '/blobs')));
  assert.ok(reads.every((s) => s === 200), `all reads succeed (${reads.filter((s) => s !== 200).length} failed)`);
  // The room's bucket is nearly full still: 100 pushes in a row go through.
  const pushes = [];
  for (let i = 0; i < 100; i++) pushes.push(await status(push(room, [env(`p${i}`)])));
  assert.ok(pushes.every((s) => s === 200), `pushes all succeed (${pushes.filter((s) => s !== 200).length} failed)`);
});

test('a photo over 512 KB is 413, by Content-Length or as it is read', async () => {
  const room = newRoom();
  await (await push(room, [env('a')])).arrayBuffer();
  const id = 'R'.repeat(43);
  const big = new Uint8Array(512 * 1024 + 1);
  const res = await call(room, `/blobs/${id}`, { method: 'PUT', body: big });
  assert.deepEqual([res.status, (await res.json()).error], [413, 'too_large']);
  // Without a Content-Length (a stream), the room stops reading past the limit.
  const stream = new ReadableStream({ start(c) { c.enqueue(big.subarray(0, 300_000)); c.enqueue(big.subarray(300_000)); c.close(); } });
  const streamed = await call(room, `/blobs/${id}`, { method: 'PUT', body: stream, duplex: 'half' });
  assert.equal(streamed.status, 413);
  await streamed.arrayBuffer();
  assert.equal(await status(call(room, `/blobs/${id}`, { method: 'PUT', body: new Uint8Array(512 * 1024) })), 200, 'exactly 512 KB');
});

test('a push over 1 MB is 413 before the room is reached', async () => {
  const room = newRoom();
  const res = await call(room, '/push', { method: 'POST', body: 'x'.repeat(1_000_001) });
  assert.deepEqual([res.status, (await res.json()).error], [413, 'too_large']);
  assert.equal(await status(pull(room)), 404, 'and nothing was claimed');
});

test('deleting a room: 410 for push, pull, live and photos afterwards, and never recreated', async () => {
  const room = newRoom();
  await (await push(room, [env('a'), env('b')])).arrayBuffer();
  const id = 'S'.repeat(43);
  await (await call(room, `/blobs/${id}`, { method: 'PUT', body: new Uint8Array([9]) })).arrayBuffer();
  const socket = await connect(room);
  assert.deepEqual(await socket.next(), { type: 'head', seq: 2 });

  assert.equal(await status(call(room, '', { method: 'DELETE', token: OTHER })), 401, 'only the room token deletes');
  const del = await call(room, '', { method: 'DELETE' });
  assert.deepEqual([del.status, await del.json()], [200, { deleted: true }]);
  assert.deepEqual(await socket.next(), { type: 'deleted' });
  assert.equal((await socket.closed).code, 4410, 'live sockets are closed');

  const r2 = await bucket();
  assert.equal((await r2.list({ prefix: `${room}/` })).objects.length, 0, 'photos deleted from R2');

  const after = [
    () => push(room, [env('c')]),
    () => push(room, [env('claim')], OTHER),
    () => pull(room),
    () => call(room, '/blobs'),
    () => call(room, `/blobs/${id}`),
    () => call(room, `/blobs/${id}`, { method: 'PUT', body: new Uint8Array([1]) }),
    () => call(room, `/blobs/${id}`, { method: 'DELETE' }),
    () => call(room, '', { method: 'DELETE' }),
  ];
  const statuses = [];
  for (const send of after) statuses.push(await status(send()));
  statuses.push(await upgradeStatus(room, `${PROTOCOL}, bearer.${TOKEN}`));
  assert.deepEqual(statuses, [410, 410, 410, 410, 410, 410, 410, 410, 410], 'push, claim, pull, photos, delete and live');
  assert.equal((await r2.list({ prefix: `${room}/` })).objects.length, 0, 'nothing was stored again');
});

test('origins: localhost on any port is allowed, others are rejected, no Origin is fine', async () => {
  const room = newRoom();
  await (await push(room, [env('a')])).arrayBuffer();
  for (const origin of ['http://localhost:5173', 'https://localhost:8443', 'http://localhost']) {
    const res = await pull(room, '', TOKEN);
    await res.arrayBuffer();
    const withOrigin = await mf.dispatchFetch(url(room, '/pull'), { headers: { ...auth(), Origin: origin } });
    assert.equal(withOrigin.status, 200, origin);
    assert.equal(withOrigin.headers.get('Access-Control-Allow-Origin'), origin);
    await withOrigin.arrayBuffer();
  }
  const preflight = await mf.dispatchFetch(url(room, '/blobs/' + 'T'.repeat(43)), { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /PUT/);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /DELETE/);
  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'https://app.example.org']) {
    const res = await mf.dispatchFetch(url(room, '/pull'), { headers: { ...auth(), Origin: origin } });
    assert.deepEqual([res.status, (await res.json()).error], [403, 'origin_not_allowed'], origin);
  }
  assert.equal(await status(pull(room)), 200, 'no Origin header (native client)');
});

test('live: the WebSocket uses library-card-sync.v1 and hears about other devices\' pushes', async () => {
  const room = newRoom();
  await (await push(room, [env('a')])).arrayBuffer();
  const socket = await connect(room, { query: '?client=device-one' });
  assert.equal(socket.ws.protocol, PROTOCOL, 'the relay answers with library-card-sync.v1');
  assert.deepEqual(await socket.next(), { type: 'head', seq: 1 });
  // A push from another device is announced; one tagged as this device's own isn't.
  await (await call(room, '/push', { method: 'POST', body: JSON.stringify({ envelopes: [env('own')] }), headers: { 'X-Sync-Client': 'device-one' } })).arrayBuffer();
  await (await push(room, [env('b')])).arrayBuffer();
  assert.deepEqual(await socket.next(), { type: 'head', seq: 3 }, 'only the other device\'s push');
  socket.ws.close(1000, 'done');
  assert.equal((await socket.closed).code, 1000);

  assert.equal(await upgradeStatus(room, `${PROTOCOL}, bearer.${TOKEN}`), 101, 'accepted');
  assert.equal(await upgradeStatus(room, `${PROTOCOL}, bearer.${OTHER}`), 401, 'wrong token');
  assert.equal(await upgradeStatus(room, `peek-sync.v1, bearer.${TOKEN}`), 401, 'Peek Budget\'s protocol is refused');
  assert.equal(await upgradeStatus(room, `bearer.${TOKEN}`), 401, 'the app protocol must be offered');
  await assert.rejects(connect(room, { token: OTHER }), /refused/, 'a browser-style client is refused too');
});
