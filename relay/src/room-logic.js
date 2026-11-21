// Library Card relay: the rules for one room, with no Cloudflare APIs, so they run (and are tested)
// in Node too. A room is an append-only log of sealed envelopes the relay can't read, plus the
// household's encrypted cover photos ("blobs"). The room's Durable Object (room.js) supplies
// storage; the Worker (index.js) routes and applies CORS. Nothing here logs request bodies, tokens
// or envelopes.
//
// Copied from Peek Budget's relay/src/room-logic.js (tcjabc/substracker f0385ee) and changed: see
// VENDORED.md. Every request is checked in this order: token format, then the room's state (410 once
// deleted), then the token (constant-time hash compare; failures use their own small bucket), then
// the room's rate limit (photo reads have their own), and only then is the body read and parsed.

/** Same idea as the client's MAX_DRIFT_MS: envelopes stamped further ahead than this are refused. */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

export const LIMITS = Object.freeze({
  maxBodyBytes: 1_000_000, // per push request
  maxEnvelopesPerPush: 500,
  maxEnvelopeChars: 64 * 1024, // the `c` field
  maxEntriesPerRoom: 200_000,
  pullLimitDefault: 500,
  pullLimitMax: 500,
  rateCapacity: 120, // requests a room may make in a burst…
  rateRefillPerSec: 2, // …refilled at this rate (120 a minute sustained)
  // Requests with the wrong token draw from their own, much smaller bucket, so guessing can't use
  // up the room's real allowance: 10 in a burst, then one every 10 seconds.
  failCapacity: 10,
  failRefillPerSec: 0.1,
  // Photo downloads and the photo list have their own, larger bucket, so a new device can fetch
  // 2,000 photos in about a minute (300 at once, then 40 a second) without using up the room's
  // allowance for pushes. Writes (push, photo PUT and DELETE) stay on the room's bucket.
  readCapacity: 300,
  readRefillPerSec: 40,
  // Cover photos.
  maxBlobBytes: 512 * 1024, // per photo, as the app stores them
  maxBlobsPerRoom: 2_000,
  maxBlobBytesPerRoom: 200 * 1024 * 1024,
});

export const PROTOCOL = 'library-card-sync.v1';
const ROOM_RE = /^[0-9a-f]{32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ID_RE = /^[\x21-\x7e]{1,128}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;
// A blob id is an HMAC-SHA256 (32 bytes) as base64url: 43 characters.
const BLOB_ID_RE = /^[A-Za-z0-9_-]{43}$/;

export const isRoomId = (v) => typeof v === 'string' && ROOM_RE.test(v);
export const isClientId = (v) => typeof v === 'string' && CLIENT_RE.test(v);
export const isBlobId = (v) => typeof v === 'string' && BLOB_ID_RE.test(v);

/** Where a room's photo lives in the bucket. */
export const blobKey = (roomId, id) => `${roomId}/${id}`;

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearer(header) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  return m ? m[1] : null;
}

/**
 * Browsers can't set headers on a WebSocket, so the client offers two subprotocols:
 * "library-card-sync.v1" and "bearer.<token>". Returns the token, or null if the offer isn't that.
 * (A header, not the URL, because URLs end up in logs.)
 */
export function protocolToken(header) {
  const offered = (header ?? '').split(',').map((s) => s.trim());
  if (!offered.includes(PROTOCOL)) return null;
  const t = offered.find((s) => s.startsWith('bearer.'))?.slice(7);
  return t && TOKEN_RE.test(t) ? t : null;
}

/** SHA-256 of the token as hex. Only this is stored; the token itself never is. */
export async function hashToken(token) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equal-length hex strings compared without stopping at the first difference. */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether a browser Origin may call the relay. `list` is comma-separated; an entry ending in
 * ":*" allows any port on that scheme and host (for local dev servers).
 */
export function originAllowed(origin, list) {
  if (typeof origin !== 'string' || !origin) return false;
  for (const raw of String(list ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.endsWith(':*')) {
      const base = entry.slice(0, -2);
      if (origin === base || (origin.startsWith(`${base}:`) && /^\d{1,5}$/.test(origin.slice(base.length + 1)))) return true;
    } else if (origin === entry) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
   Routes
   -------------------------------------------------------------------------- */
// /v1/rooms/:room                    DELETE  delete the room
// /v1/rooms/:room/push               POST
// /v1/rooms/:room/pull               GET
// /v1/rooms/:room/live               GET (WebSocket)
// /v1/rooms/:room/blobs              GET     list photo ids
// /v1/rooms/:room/blobs/:id          PUT, GET, DELETE
const ROUTE = /^\/v1\/rooms\/([^/]+)(?:\/(push|pull|live|blobs)(?:\/([^/]+))?)?$/;
const METHODS = {
  room: ['DELETE'],
  push: ['POST'],
  pull: ['GET'],
  live: ['GET'],
  blobs: ['GET'],
  blob: ['PUT', 'GET', 'DELETE'],
};

/**
 * The route for a path and method: { roomId, action, blobId? } with action one of 'delete',
 * 'push', 'pull', 'live', 'listBlobs', 'putBlob', 'getBlob', 'deleteBlob'; or { reply } with the
 * error to send. Only the URL is checked here.
 */
export function parseRoute(pathname, method) {
  const m = ROUTE.exec(pathname);
  if (!m) return { reply: problem(404, 'not_found', 'Unknown endpoint.') };
  const [, roomId, part, id] = m;
  if (id !== undefined && part !== 'blobs') return { reply: problem(404, 'not_found', 'Unknown endpoint.') };
  if (!isRoomId(roomId)) return { reply: problem(400, 'bad_room', 'A room id is 32 hex characters.') };
  const kind = part === undefined ? 'room' : part === 'blobs' && id !== undefined ? 'blob' : part;
  const allowed = METHODS[kind];
  if (!allowed.includes(method)) {
    return { reply: problem(405, 'method_not_allowed', `Use ${allowed.join(' or ')}.`, { Allow: allowed.join(', ') }) };
  }
  if (kind === 'blob' && !isBlobId(id)) return { reply: problem(400, 'bad_blob_id', 'A photo id is 43 base64url characters.') };
  const action = kind === 'room' ? 'delete'
    : kind === 'blobs' ? 'listBlobs'
      : kind === 'blob' ? { PUT: 'putBlob', GET: 'getBlob', DELETE: 'deleteBlob' }[method]
        : kind;
  return { roomId, action, ...(kind === 'blob' ? { blobId: id } : {}) };
}

/* --------------------------------------------------------------------------
   Bodies
   -------------------------------------------------------------------------- */
/** Thrown by readLimited when a body is bigger than allowed. */
export class TooLarge extends Error {}

/**
 * Reads a request body stream into bytes, stopping (and throwing TooLarge) as soon as it passes
 * `max` bytes, so a body without a Content-Length can't be read in full first.
 */
export async function readLimited(stream, max) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge('Body too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const reply = (status, body, headers) => ({ status, body, ...(headers ? { headers } : {}) });
const problem = (status, error, message, headers) => reply(status, { error, message }, headers);
const gone = () => problem(410, 'room_deleted', 'This room was deleted. Its data is gone.');

/* --------------------------------------------------------------------------
   One room
   -------------------------------------------------------------------------- */
/**
 * One room's behaviour over a storage adapter:
 *   exists() → bool                 tokenHash() → hex | null
 *   claim(hash, at) → stored hash   (first claim wins; later calls return the existing hash)
 *   head() → highest seq (0 if none); seqs have no gaps, so this is also the entry count
 *   insert(envelopes, at) → number stored (ids already present are skipped; one transaction)
 *   after(seq, limit) → [{ seq, id, wall, c }] in seq order
 *   deleted() → bool                markDeleted() (drops the log and photo list, keeps the token hash)
 *   blobSize(id) → bytes | null     blobTotals() → { count, bytes }
 *   blobAdd(id, size, at)           blobRemove(id)       blobIds() → [ids] sorted
 * and a photo bucket adapter (R2 in production, a Map in tests):
 *   put(key, bytes)   get(key) → bytes | null   delete(keys)   list(prefix) → [keys]
 * Methods return { status, body, headers?, bytes? } for the caller to turn into a Response.
 */
export class RoomCore {
  constructor(store, { now = () => Date.now(), limits = LIMITS, blobs = null, roomId = null } = {}) {
    this.store = store;
    this.now = now;
    this.limits = { ...LIMITS, ...limits };
    this.blobs = blobs;
    this.roomId = roomId;
    this.bucket = { tokens: this.limits.rateCapacity, at: now() };
    this.failBucket = { tokens: this.limits.failCapacity, at: now() };
    this.readBucket = { tokens: this.limits.readCapacity, at: now() };
  }

  /** Takes one token from a bucket; null if there was one, otherwise the 429 reply. State is in memory. */
  take(b, capacity, perSec) {
    const t = this.now();
    b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * perSec);
    b.at = t;
    if (b.tokens >= 1) { b.tokens -= 1; return null; }
    const wait = Math.ceil((1 - b.tokens) / perSec);
    return problem(429, 'rate_limited', 'Too many requests for this room. Try again shortly.', { 'Retry-After': String(wait) });
  }

  /** The room's rate limit, for requests with the right token. */
  limited() {
    return this.take(this.bucket, this.limits.rateCapacity, this.limits.rateRefillPerSec);
  }

  /** Photo downloads and the photo list: their own bucket, so they never use up the room's allowance for writes. */
  limitedRead() {
    return this.take(this.readBucket, this.limits.readCapacity, this.limits.readRefillPerSec);
  }

  /** A wrong token: 401, or 429 once the small failed-auth bucket is empty. Never touches the room's bucket. */
  failedAuth() {
    return this.take(this.failBucket, this.limits.failCapacity, this.limits.failRefillPerSec)
      ?? problem(401, 'unauthorized', 'This token does not open this room.');
  }

  /**
   * Token format, room state, token, then rate limit (`read` uses the photo-read bucket). Returns
   * { reply } to stop, or { hash, claim } to go on, where `claim` means the room is new and this push
   * will claim it once its body checks out (so a malformed first push creates nothing).
   */
  async gate(token, { claim = false, read = false } = {}) {
    if (!token || !TOKEN_RE.test(token)) return { reply: problem(401, 'unauthorized', 'Missing or malformed token.') };
    const hash = await hashToken(token);
    if (this.store.deleted()) return { reply: gone() };
    const stored = this.store.exists() ? this.store.tokenHash() : null;
    if (stored === null) {
      if (!claim) return { reply: problem(404, 'no_room', 'This room has no data yet.') };
    } else if (!sameHash(hash, stored)) {
      return { reply: this.failedAuth() };
    }
    const limited = read ? this.limitedRead() : this.limited();
    if (limited) return { reply: limited };
    return { hash, claim: stored === null };
  }

  /** null when the token may use this room; otherwise the reply. `claim` creates the room on first use. */
  async authorize(token, { claim = false } = {}) {
    const g = await this.gate(token, { claim });
    if (g.reply) return g.reply;
    if (g.claim) this.store.claim(g.hash, this.now());
    return null;
  }

  /** After awaiting a body: the room may have been deleted, or claimed by someone else, meanwhile. */
  recheck(g) {
    if (this.store.deleted()) return gone();
    if (g.claim) {
      const stored = this.store.claim(g.hash, this.now()); // trust on first use
      if (!sameHash(g.hash, stored)) return this.failedAuth();
    }
    return null;
  }

  /**
   * POST /push { envelopes } → { head, accepted, rejected }. Duplicates are ignored, never errors.
   * `readBody` reads the body (only after the token and rate limit pass); tests may pass `bodyText`.
   */
  async push({ token, bodyText, readBody = async () => bodyText }) {
    const L = this.limits;
    const g = await this.gate(token, { claim: true });
    if (g.reply) return g.reply;
    let text;
    try { text = await readBody(); } catch (err) {
      if (err instanceof TooLarge) return problem(413, 'too_large', `A push may be at most ${L.maxBodyBytes} bytes.`);
      throw err;
    }
    if (typeof text !== 'string' || text.length > L.maxBodyBytes) {
      return problem(413, 'too_large', `A push may be at most ${L.maxBodyBytes} bytes.`);
    }
    let body;
    try { body = JSON.parse(text); } catch { return problem(400, 'bad_json', 'The body is not JSON.'); }
    const list = body?.envelopes;
    if (!Array.isArray(list)) return problem(400, 'bad_request', '"envelopes" must be a list.');
    if (list.length > L.maxEnvelopesPerPush) {
      return problem(413, 'too_many', `A push may carry at most ${L.maxEnvelopesPerPush} envelopes.`);
    }
    for (const e of list) {
      if (!e || typeof e !== 'object' || !ID_RE.test(e.id ?? '') || !Number.isSafeInteger(e.wall) || e.wall < 0
        || typeof e.c !== 'string' || !e.c.length || e.c.length > L.maxEnvelopeChars || !B64_RE.test(e.c)) {
        return problem(400, 'bad_envelope', 'An envelope is malformed.');
      }
    }
    const denied = this.recheck(g);
    if (denied) return denied;

    const before = this.store.head();
    if (before >= L.maxEntriesPerRoom) {
      return problem(507, 'room_full', `This room is full (${L.maxEntriesPerRoom} entries). Nothing was stored.`);
    }
    // Far-future stamps are refused one by one, so the rest of the push still lands.
    const limit = this.now() + MAX_DRIFT_MS;
    const rejected = [];
    const keep = [];
    for (const e of list) {
      if (e.wall > limit) rejected.push(e.id);
      else keep.push({ id: e.id, wall: e.wall, c: e.c });
    }
    const accepted = keep.length ? this.store.insert(keep, this.now()) : 0;
    return reply(200, { head: this.store.head(), accepted, rejected });
  }

  /** GET /pull?after=N&limit=M → { entries, head } */
  async pull({ token, after, limit }) {
    const L = this.limits;
    const g = await this.gate(token);
    if (g.reply) return g.reply;
    const a = after === undefined || after === null || after === '' ? 0 : Number(after);
    const n = limit === undefined || limit === null || limit === '' ? L.pullLimitDefault : Number(limit);
    if (!Number.isSafeInteger(a) || a < 0) return problem(400, 'bad_request', '"after" must be a whole number of 0 or more.');
    if (!Number.isSafeInteger(n) || n < 1) return problem(400, 'bad_request', '"limit" must be a whole number of 1 or more.');
    return reply(200, { entries: this.store.after(a, Math.min(n, L.pullLimitMax)), head: this.store.head() });
  }

  /** May this token open a live connection? null if yes; otherwise the reply. */
  async live({ token }) {
    const g = await this.gate(token);
    return g.reply ?? null;
  }

  /**
   * DELETE the room: its log, its photo list and every photo in the bucket. A small marker (the
   * token hash and a deleted flag) stays, so the room can never be claimed again: every later
   * request gets 410. Repeating the delete with the right token deletes any photos left behind
   * (if a bucket call failed the first time) and still answers 410.
   */
  async deleteRoom({ token }) {
    if (!token || !TOKEN_RE.test(token)) return problem(401, 'unauthorized', 'Missing or malformed token.');
    if (this.store.deleted()) {
      if (sameHash(await hashToken(token), this.store.tokenHash())) await this.purgeBlobs();
      return gone();
    }
    const g = await this.gate(token);
    if (g.reply) return g.reply;
    this.store.markDeleted();
    await this.purgeBlobs();
    return reply(200, { deleted: true });
  }

  async purgeBlobs() {
    if (!this.blobs || !this.roomId) return;
    const keys = await this.blobs.list(`${this.roomId}/`);
    for (let i = 0; i < keys.length; i += 1000) await this.blobs.delete(keys.slice(i, i + 1000));
  }

  /** PUT /blobs/:id with the encrypted photo as the body. 413 over the size limit, 507 over the room's quota. */
  async putBlob({ token, id, readBytes }) {
    const L = this.limits;
    const g = await this.gate(token);
    if (g.reply) return g.reply;
    if (!isBlobId(id)) return problem(400, 'bad_blob_id', 'A photo id is 43 base64url characters.');
    let bytes;
    try { bytes = await readBytes(); } catch (err) {
      if (err instanceof TooLarge) return problem(413, 'too_large', `A photo may be at most ${L.maxBlobBytes} bytes.`);
      throw err;
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > L.maxBlobBytes) {
      return problem(413, 'too_large', `A photo may be at most ${L.maxBlobBytes} bytes.`);
    }
    if (bytes.byteLength === 0) return problem(400, 'bad_request', 'A photo cannot be empty.');
    const denied = this.recheck(g);
    if (denied) return denied;
    // Quota: count and total size, counting a replaced photo's old size out.
    const previous = this.store.blobSize(id);
    const { count, bytes: total } = this.store.blobTotals();
    if (previous === null && count >= L.maxBlobsPerRoom) {
      return problem(507, 'blobs_full', `This room has ${L.maxBlobsPerRoom} photos, the most it can hold.`);
    }
    if (total - (previous ?? 0) + bytes.byteLength > L.maxBlobBytesPerRoom) {
      return problem(507, 'blobs_full', `This room's photos would pass ${L.maxBlobBytesPerRoom} bytes.`);
    }
    // Reserve the space first, so two uploads at once can't both squeeze under the quota.
    this.store.blobAdd(id, bytes.byteLength, this.now());
    try {
      await this.blobs.put(blobKey(this.roomId, id), bytes);
    } catch (err) {
      if (previous === null) this.store.blobRemove(id);
      else this.store.blobAdd(id, previous, this.now());
      throw err;
    }
    // Deleted while uploading: don't leave the photo behind.
    if (this.store.deleted()) {
      await this.blobs.delete([blobKey(this.roomId, id)]);
      return gone();
    }
    return reply(200, { id, size: bytes.byteLength });
  }

  /** GET /blobs/:id → the stored bytes. Uses the photo-read bucket. */
  async getBlob({ token, id }) {
    const g = await this.gate(token, { read: true });
    if (g.reply) return g.reply;
    if (!isBlobId(id)) return problem(400, 'bad_blob_id', 'A photo id is 43 base64url characters.');
    const bytes = this.store.blobSize(id) === null ? null : await this.blobs.get(blobKey(this.roomId, id));
    if (!bytes) return problem(404, 'no_blob', 'There is no photo with this id.');
    if (this.store.deleted()) return gone();
    return { status: 200, bytes };
  }

  /** DELETE /blobs/:id → 204, or 404 if there was none. */
  async deleteBlob({ token, id }) {
    const g = await this.gate(token);
    if (g.reply) return g.reply;
    if (!isBlobId(id)) return problem(400, 'bad_blob_id', 'A photo id is 43 base64url characters.');
    if (this.store.blobSize(id) === null) return problem(404, 'no_blob', 'There is no photo with this id.');
    this.store.blobRemove(id);
    await this.blobs.delete([blobKey(this.roomId, id)]);
    return { status: 204 };
  }

  /** GET /blobs → { ids, count, bytes }: every photo id in the room, sorted. Uses the photo-read bucket. */
  async listBlobs({ token }) {
    const g = await this.gate(token, { read: true });
    if (g.reply) return g.reply;
    return reply(200, { ids: this.store.blobIds(), ...this.store.blobTotals() });
  }
}

/** An in-memory store with the same behaviour as the SQLite one, for tests and local experiments. */
export function memoryStore() {
  let hash = null;
  let deleted = false;
  let entries = [];
  let ids = new Set();
  let blobs = new Map();
  return {
    exists: () => hash !== null,
    tokenHash: () => hash,
    claim(h) { if (hash === null) hash = h; return hash; },
    head: () => entries.length,
    insert(list, at) {
      let added = 0;
      for (const e of list) {
        if (ids.has(e.id)) continue;
        ids.add(e.id);
        entries.push({ seq: entries.length + 1, id: e.id, wall: e.wall, c: e.c, received_at: at });
        added++;
      }
      return added;
    },
    after: (seq, limit) => entries.slice(seq, seq + limit).map(({ seq: s, id, wall, c }) => ({ seq: s, id, wall, c })),
    deleted: () => deleted,
    markDeleted() { deleted = true; entries = []; ids = new Set(); blobs = new Map(); },
    blobSize: (id) => blobs.get(id)?.size ?? null,
    blobTotals: () => ({ count: blobs.size, bytes: [...blobs.values()].reduce((n, b) => n + b.size, 0) }),
    blobAdd(id, size, at) { blobs.set(id, { size, at }); },
    blobRemove(id) { blobs.delete(id); },
    blobIds: () => [...blobs.keys()].sort(),
    get size() { return entries.length; },
  };
}

/** An in-memory photo bucket with R2's few operations used here, for tests. */
export function memoryBlobs() {
  const objects = new Map();
  return {
    async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); },
    async get(key) { return objects.get(key) ?? null; },
    async delete(keys) { for (const k of keys) objects.delete(k); },
    async list(prefix) { return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    get size() { return objects.size; },
  };
}
