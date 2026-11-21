# Library Card relay

> **Not deployed yet.** Nothing in the app talks to the relay so far; sync arrives in a later phase.

A small Cloudflare Worker that passes encrypted changes and encrypted cover photos between the devices of one household. Each household is a **room**: one Durable Object holding an append-only log of sealed envelopes in SQLite, plus the room's photos in an R2 bucket. The relay can't read any of it; devices encrypt and decrypt with a key the relay never sees.

Copied from Peek Budget's relay and changed (see [VENDORED.md](../VENDORED.md) for the source, commit, hashes and every change).

```
src/index.js       Worker: routes /v1/rooms/:roomId/… to the room, CORS, early size checks
src/room.js        Durable Object "LibraryRoom": SQLite log, photo list, R2 photos, hibernating WebSockets
src/room-logic.js  The rules (auth, validation, limits, rate limits, routes) with no Cloudflare APIs, tested in Node
test/              Node tests: the rules (in Node) and the Worker end to end (in local workerd)
wrangler.toml      Worker config: Durable Object + SQLite migration, R2 bucket, allowed origins, logging
```

## API

All endpoints are under `/v1/rooms/:roomId`, where `roomId` is 32 hex characters. Requests carry `Authorization: Bearer <token>`. The room id and token are both derived from the household key (see `src/sync/vendor/crypto.js` in the app), so they look random and are different for every household.

| Request | Response |
| --- | --- |
| `POST /push` with `{ "envelopes": [{ "id", "wall", "c" }, …] }` | `{ "head", "accepted", "rejected": [ids] }` |
| `GET /pull?after=N&limit=500` | `{ "entries": [{ "seq", "id", "wall", "c" }, …], "head" }` |
| `GET /live` (WebSocket) | messages `{ "type": "head", "seq" }`, and `{ "type": "deleted" }` |
| `PUT /blobs/:id` with the encrypted photo as the body | `{ "id", "size" }` |
| `GET /blobs/:id` | the stored bytes (`application/octet-stream`) |
| `DELETE /blobs/:id` | `204` |
| `GET /blobs` | `{ "ids": [ids], "count", "bytes" }` |
| `DELETE` (the room itself) | `{ "deleted": true }` |
| `GET /v1/health` (no room, no token) | `{ "ok": true }` |

- **Order of checks.** Every request: the token's format, then whether the room was deleted (`410`), then the token (a constant-time compare of its SHA-256 with the stored one), then the room's rate limit, and only then is the body read. Wrong tokens draw from their own small bucket (10, then one every 10 seconds), so guessing can never use up the room's real allowance.
- **Rate limits.** Writes and the log (push, pull, live, photo upload and delete, room delete) share the room's bucket: 120 at once, then 2 a second. Photo downloads and the photo list have their own: 300 at once, then 40 a second, so a new device can fetch 2,000 photos in about a minute without using up the allowance for pushes.
- **Push** is idempotent: an envelope id that's already stored is skipped, never an error. `accepted` counts the new ones. App op ids are deterministic, so re-sent ops are skipped. An envelope whose `wall` is more than 24 hours ahead of the relay's clock is refused (listed in `rejected`) while the rest of the push is stored.
- **Pull** returns entries in `seq` order, at most 500 at a time. Page with `after` = the last `seq` you got until you reach `head`.
- **Live** never carries data. On connect, and after every push that stored something, it sends the current `head` to the other connected devices, which then pull. A browser can't put an `Authorization` header on a WebSocket, so the client offers the subprotocols `library-card-sync.v1` and `bearer.<token>`; the relay answers with `library-card-sync.v1`. Send `ping` to keep it open (answered with `pong` without waking the object). The optional `?client=<random id>` only stops a device being told about its own push.
- **Rooms** come into existence on the first valid push, which stores a SHA-256 of that device's token (trust on first use). After that, any other token gets `401`. Pull, live or photos on a room that doesn't exist get `404`; nothing is created.
- **Photos** are stored in R2 under `<room id>/<photo id>`. A photo id is 43 base64url characters (the app's keyed blob id). The relay only ever stores the bytes it's given, already encrypted by the app.
- **Deleting a room** (with the room token) deletes its log, its photo list and every photo in R2, and closes its live connections (`{ "type": "deleted" }`, then close code 4410). A small marker stays (the token hash and a deleted flag), so the room is never recreated: every later request, even a first-push claim, gets `410`. Repeating the delete with the right token deletes any photos left behind.

Errors are JSON `{ "error": code, "message": text }`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_json`, `bad_request`, `bad_envelope`, `bad_room`, `bad_blob_id` | Malformed request |
| 401 | `unauthorized` | Missing token, or not this room's token |
| 403 | `origin_not_allowed` | A browser origin not in `ALLOWED_ORIGINS` |
| 404 | `no_room`, `no_blob`, `not_found` | No such room, photo or endpoint |
| 405 | `method_not_allowed` | Wrong method (`Allow` says which) |
| 410 | `room_deleted` | The room was deleted |
| 413 | `too_large`, `too_many` | Push body over 1 MB or over 500 envelopes; photo over 512 KB |
| 426 | `upgrade_required` | `/live` without a WebSocket upgrade |
| 429 | `rate_limited` | Over 120 requests in a burst / 2 per second for the room; over 300 / 40 per second for photo downloads and the photo list; or too many wrong tokens (`Retry-After` says when) |
| 507 | `room_full`, `blobs_full` | 200,000 log entries; or 2,000 photos or 200 MB of photos |

Limits are in `LIMITS` in `src/room-logic.js`.

## What the relay can and cannot see

It **cannot** see book titles, children's names, reading history, cover photos or anything else in the app, the household key, or the encryption keys. It can't make changes that devices would accept: envelopes and photos are AES-GCM sealed and devices drop any that fail to open.

It **can** see, and Cloudflare could see:

- The room id (random-looking, one per household) and the token (stored only as a SHA-256 hash).
- How many changes and photos are sent, when, and roughly how large they are (op contents are padded to 64-byte steps).
- Each change's `wall` time: when it was made, to the millisecond. It needs this to refuse far-future stamps.
- Op and photo ids. Both are keyed with the household key, so they can't be linked to a book or a photo without it.
- IP addresses and connection times, at Cloudflare's network level. The relay code doesn't record or log them.

It stores nothing about clients: no IPs, user agents or device names. For the log it keeps only `seq`, envelope `id`, `wall`, `c` and the time each entry arrived; for photos, the id, size and upload time, and the encrypted bytes in R2. It could also refuse to relay, replay or drop changes. Devices treat every change as idempotent and order-independent, so a replay does nothing; dropped changes simply don't arrive.

Logging: `wrangler.toml` turns off per-request invocation logs, which record URLs and request metadata. The code never logs bodies, tokens, envelopes or photos; it only logs the name of an unexpected error.

## Run locally

No Cloudflare account is needed.

```sh
cd relay
npm install
npm run dev                 # wrangler dev: http://localhost:8787, with a local Durable Object and R2 bucket
npm test                    # the rules in Node, then the Worker end to end in local workerd
```

Local data is kept under `relay/.wrangler/` (ignored by git). `curl http://localhost:8787/v1/health` answers `{"ok":true}`.

## Deploy (later)

Not done yet. When sync is ready:

```sh
cd relay
npm install
npx wrangler login                                    # sign in to Cloudflare in the browser
npx wrangler r2 bucket create library-card-blobs      # the photo bucket, once
npx wrangler deploy --var "ALLOWED_ORIGINS:<the app's origin>,http://localhost:*,https://localhost:*"
```

`wrangler deploy` creates the Worker, the `LibraryRoom` Durable Object class (migration `library-card-v1`) and binds the bucket, and prints the URL, for example `https://library-card-relay.<your-subdomain>.workers.dev`. The committed `wrangler.toml` only allows `localhost` origins, so set the app's real origin (for GitHub Pages, `https://<user>.github.io`) with `--var` as above, or under the Worker's **Settings > Variables** in the Cloudflare dashboard. `wrangler.toml` sets `keep_vars = true`, so a later `wrangler deploy` keeps a value set in the dashboard instead of resetting `ALLOWED_ORIGINS` to localhost. SQLite-backed Durable Objects and R2 are available on the Workers Free plan, within its limits.
