// One Durable Object per room (addressed by the room id). SQLite storage holds the append-only
// entry log, the room's token hash (and, once deleted, a deleted flag) and the list of the room's
// photos; the photos themselves live in R2 under "<room>/<id>". Live WebSockets use the
// Hibernation API, so idle rooms cost nothing. The socket only ever says "there is something new";
// data always goes through /pull.
//
// Copied from Peek Budget's relay/src/room.js (tcjabc/substracker f0385ee) and changed: see VENDORED.md.

import { DurableObject } from 'cloudflare:workers';
import { RoomCore, PROTOCOL, bearer, protocolToken, isClientId, parseRoute, readLimited, LIMITS } from './room-logic.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS room (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    wall INTEGER NOT NULL,
    c TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );`;

/** RoomCore's storage adapter over the object's SQLite database. Tables appear on the first push only. */
class SqlStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  hasTables() {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'").toArray().length > 0;
  }

  exists() {
    return this.hasTables() && this.tokenHash() !== null;
  }

  tokenHash() {
    return this.sql.exec('SELECT token_hash FROM room WHERE id = 1').toArray()[0]?.token_hash ?? null;
  }

  deleted() {
    return this.hasTables() && this.sql.exec('SELECT deleted FROM room WHERE id = 1').toArray()[0]?.deleted === 1;
  }

  claim(hash, at) {
    return this.storage.transactionSync(() => {
      this.sql.exec(SCHEMA);
      this.sql.exec('INSERT OR IGNORE INTO room (id, token_hash, created_at) VALUES (1, ?, ?)', hash, at);
      return this.tokenHash();
    });
  }

  /** Drop the log and the photo list; keep the token hash, flagged deleted. One transaction. */
  markDeleted() {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM entries');
      this.sql.exec('DELETE FROM blobs');
      this.sql.exec('UPDATE room SET deleted = 1 WHERE id = 1');
    });
  }

  head() {
    if (!this.exists()) return 0;
    return this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS head FROM entries').one().head;
  }

  /** Store new envelopes, skipping ids already present; returns how many were new. */
  insert(list, at) {
    // Check first rather than INSERT OR IGNORE: with AUTOINCREMENT an ignored row still uses up
    // a seq, which would leave gaps and make head - before overcount.
    return this.storage.transactionSync(() => {
      let added = 0;
      for (const e of list) {
        if (this.sql.exec('SELECT 1 FROM entries WHERE id = ?', e.id).toArray().length) continue;
        this.sql.exec('INSERT INTO entries (id, wall, c, received_at) VALUES (?, ?, ?, ?)', e.id, e.wall, e.c, at);
        added++;
      }
      return added;
    });
  }

  after(seq, limit) {
    return this.sql.exec('SELECT seq, id, wall, c FROM entries WHERE seq > ? ORDER BY seq LIMIT ?', seq, limit).toArray();
  }

  blobSize(id) {
    return this.sql.exec('SELECT size FROM blobs WHERE id = ?', id).toArray()[0]?.size ?? null;
  }

  blobTotals() {
    const row = this.sql.exec('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM blobs').one();
    return { count: row.count, bytes: row.bytes };
  }

  blobAdd(id, size, at) {
    this.sql.exec('INSERT INTO blobs (id, size, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET size = excluded.size', id, size, at);
  }

  blobRemove(id) {
    this.sql.exec('DELETE FROM blobs WHERE id = ?', id);
  }

  blobIds() {
    return this.sql.exec('SELECT id FROM blobs ORDER BY id').toArray().map((r) => r.id);
  }
}

/** RoomCore's photo bucket adapter over R2. */
function r2Blobs(bucket) {
  return {
    put: (key, bytes) => bucket.put(key, bytes),
    async get(key) {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    delete: (keys) => (keys.length ? bucket.delete(keys) : undefined),
    async list(prefix) {
      const keys = [];
      let cursor;
      do {
        const page = await bucket.list({ prefix, cursor });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
  };
}

const json = ({ status, body, headers }) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: status === 204 ? headers : { 'Content-Type': 'application/json', ...headers },
});

const decoder = new TextDecoder();

export class LibraryRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new SqlStore(ctx.storage);
    this.cores = new Map();
    // Clients may send "ping" to keep a connection open; it's answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The room's rules. The room id comes from the URL (one object per room id), for photo keys. */
  core(roomId) {
    if (!this.cores.has(roomId)) {
      this.cores.set(roomId, new RoomCore(this.store, { blobs: r2Blobs(this.env.BLOBS), roomId }));
    }
    return this.cores.get(roomId);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = parseRoute(url.pathname, request.method);
    if (route.reply) return json(route.reply);
    const core = this.core(route.roomId);
    const token = bearer(request.headers.get('Authorization'));
    switch (route.action) {
      case 'push': {
        const r = await core.push({ token, readBody: async () => decoder.decode(await readLimited(request.body, LIMITS.maxBodyBytes)) });
        if (r.status === 200 && r.body.accepted > 0) this.notify(r.body.head, request.headers.get('X-Sync-Client'));
        return json(r);
      }
      case 'pull':
        return json(await core.pull({ token, after: url.searchParams.get('after'), limit: url.searchParams.get('limit') }));
      case 'live':
        return this.live(core, request, url);
      case 'delete': {
        const r = await core.deleteRoom({ token });
        if (r.status === 200) this.closeAll();
        return json(r);
      }
      case 'listBlobs':
        return json(await core.listBlobs({ token }));
      case 'putBlob':
        return json(await core.putBlob({ token, id: route.blobId, readBytes: () => readLimited(request.body, LIMITS.maxBlobBytes) }));
      case 'getBlob': {
        const r = await core.getBlob({ token, id: route.blobId });
        if (!r.bytes) return json(r);
        return new Response(r.bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
      }
      case 'deleteBlob':
        return json(await core.deleteBlob({ token, id: route.blobId }));
      default:
        return json({ status: 404, body: { error: 'not_found', message: 'Unknown endpoint.' } });
    }
  }

  async live(core, request, url) {
    const denied = await core.live({ token: protocolToken(request.headers.get('Sec-WebSocket-Protocol')) });
    if (denied) return json(denied);
    const client = url.searchParams.get('client');
    const [clientSide, server] = Object.values(new WebSocketPair());
    // The tag is a random id the page picks per load, used only to skip telling a device about its own push.
    this.ctx.acceptWebSocket(server, isClientId(client) ? [client] : []);
    server.send(JSON.stringify({ type: 'head', seq: this.store.head() }));
    return new Response(null, { status: 101, webSocket: clientSide, headers: { 'Sec-WebSocket-Protocol': PROTOCOL } });
  }

  /** Tell every other connected device there is something new. */
  notify(seq, fromClient) {
    const msg = JSON.stringify({ type: 'head', seq });
    for (const ws of this.ctx.getWebSockets()) {
      if (isClientId(fromClient) && this.ctx.getTags(ws).includes(fromClient)) continue;
      try { ws.send(msg); } catch { /* closing; it will reconnect and pull */ }
    }
  }

  /** The room was deleted: say so and close every live connection (4410, like HTTP 410). */
  closeAll() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'deleted' }));
        ws.close(4410, 'room deleted');
      } catch { /* already closing */ }
    }
  }

  webSocketMessage() {
    // Clients never send data on the socket ("ping" is auto-answered); anything else is ignored.
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* already closed, or a reserved code */ }
  }

  webSocketError() {}
}
