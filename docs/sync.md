# Sync between devices

How Library Card keeps one household's data the same on several devices. The engine, crypto and
relay are adapted from Peek Budget (MIT); [VENDORED.md](../VENDORED.md) lists every copied file,
its upstream hash and what changed.

Status: the record layer (6c), the engine and its service (6d-1) and the relay (6b, not deployed)
exist. Nothing in the app uses sync yet: the screens come in 6d-2 and cover photos in 6e. The
default build still uses the local adapter (`VITE_DATA_ADAPTER=local`).

## Goals

- Every device has all the data and works offline. Sync never blocks a save; failures become a
  status and a retry.
- End-to-end encrypted. The relay stores and forwards sealed envelopes it can't read.
- No accounts. A household is a random 128-bit key, shown as 12 recovery words (BIP-39 English
  list) and as a QR code of those words.
- Converges: devices that have seen the same ops show the same data, whatever order the ops came
  in, with no server-side merging.
- Small and cheap to run: one Cloudflare Worker, a Durable Object per household and an R2 bucket
  for photos.

## Pieces

| Layer | Where | What it does |
| --- | --- | --- |
| Record layer | `src/data/sync/` | Every write to a synced table also becomes field-level ops in the same IndexedDB transaction (records, outbox, clock). Remote ops update records; the typed tables are rebuilt from them. |
| Engine | `src/sync/vendor/sync.js` | Pushes the outbox, pulls new entries, keeps a live socket, retries with backoff. |
| Key vault | `src/sync/vendor/secure-key.js` | Where the key lives. Web only: in the IndexedDB sync config. |
| Pairing | `src/sync/vendor/pairing.js`, `qr-scan.js`, `words.js` | Join decisions and wording, recovery words, checking a scanned QR text. |
| Service | `src/sync/service.ts` | Runs the engine in one tab, maps its status for the UI, and offers `start`, `join`, `stop`, `deleteHousehold`, `syncNow`. |
| Relay | `relay/` | Stores envelopes in order per room, announces new ones over a WebSocket, stores encrypted photos. See [relay/README.md](../relay/README.md). |

## What the relay sees

- The room id (32 hex characters, derived from the key) and the room token (43 base64url
  characters, derived from the key; the relay keeps only its SHA-256).
- Envelopes: `{ id, wall, c }`. `c` is AES-GCM ciphertext of the op, padded to 64-byte steps.
- Op ids: keyed and deterministic (below), so they can't be linked to a record or field without
  the key, but the same op always has the same id.
- Wall times: each op's `wall` (when it was made, to the millisecond), so the relay can refuse
  stamps more than 24 hours ahead.
- Sizes and timing: how many envelopes and photos, how big, when; IP addresses at Cloudflare's
  network level (the relay code doesn't log them).

It never sees the key, the recovery words, record ids, field names, values or photo contents.

## Protocol constants

| Constant | Value |
| --- | --- |
| Key | 16 random bytes, stored as 22 characters of base64url; shown as 12 words (11 bits each, 4-bit checksum) |
| HKDF-SHA256 salt | `library-card/sync/v1` |
| HKDF info | `library-card/v1/room-id`, `library-card/v1/relay-token`, `library-card/v1/op-encryption`, `library-card/v1/op-id`, `library-card/v1/blob-encryption`, `library-card/v1/blob-id` |
| Op AAD | `library-card/v1/op\|<id>\|<wall>` |
| Endpoints | `POST /v1/rooms/:room/push`, `GET /v1/rooms/:room/pull?after=&limit=`, `GET /v1/rooms/:room/live` (WebSocket), `DELETE /v1/rooms/:room`, `/v1/rooms/:room/blobs[/:id]`, `GET /v1/health` |
| WebSocket subprotocols | `library-card-sync.v1` and `bearer.<token>` |
| Pull page | 500 entries |
| Push batch | up to 200 ops and 512,000 characters (halved after a 413) |
| Local change debounce | 1 s |
| Polling | every 10 minutes while the live socket is open; every 60 s while it is down or unsupported; none while the page is hidden |
| Retry backoff | 2 s, doubling to 5 minutes, each ×0.5–1.5 jitter; 429 waits for `Retry-After`; 507 waits an hour; 401 waits for a manual sync or a config change |
| Socket | ping every 30 s; reconnect backoff up to 60 s |
| Clock drift | ops stamped more than 24 hours ahead are refused by the relay and stay queued ("this device's clock is more than a day ahead") |
| Deleted room | HTTP 410; socket message `{"type":"deleted"}`, then close code 4410 |

## Ops and op ids

An op is `{ rec, f, v, t, dev }`: one field of one record. `t` is a hybrid logical clock stamp
`<wall>-<counter>-<device id>`, compared as text; `dev` is the device's random id. A delete is
the field `del` set to `true` (a tombstone; the record stays).

Op ids are keyed and deterministic: the first 128 bits of HMAC-SHA256 over `rec|f|t`, with a key
derived from the household key (info `library-card/v1/op-id`), as 22 characters of base64url.
Deterministic, so the relay skips an op it already has (re-sends and re-joins never duplicate
entries); keyed, so the relay can't tell which record or field an id belongs to.

## Wire schema

A record's id is `<table>:<local id>`. `household_id` is implied (one household per device,
`main`) and never sent; the local key is in the record id, not a field. Unknown but well-formed
fields (up to 8,192 characters of JSON) are kept and ignored, so an older device doesn't drop what
a newer one sends. Known fields must have the right type and size or the op is skipped.

| Table | Local id | Fields (required in bold) |
| --- | --- | --- |
| `households` | `main` | **name** (text ≤ 200), parent_pin_hash (text ≤ 300 or null) |
| `readers` | id | **display_name** (≤ 200), **avatar** (≤ 32), **card_token** (≤ 200), active_journey_id (id or null) |
| `books` | ISBN-13 or `noisbn-<id>` | **title** (≤ 1000), **authors** (≤ 50 texts of ≤ 300), cover_url (≤ 4096 or null), **source** (≤ 32) |
| `home_items` | book key | **isbn** (book key), **added_at** (timestamp) |
| `libraries` | id | **name** (≤ 200), search_url_template, homepage_url (≤ 4096 or null), **default_loan_days** (1–3650), sticker_prefix (≤ 64 or null) |
| `loans` | id | **reader_id**, **isbn**, library_id, library_name (≤ 300), sticker_barcode (≤ 200), **borrowed_at**, due_date (YYYY-MM-DD or null), returned_at, **renew_count** (0–100,000) |
| `read_events` | id | **reader_id**, **isbn**, **read_at** |
| `reader_journeys` | id | **reader_id**, **journey_id** (≤ 64), **started_at**, completed_at, abandoned_at |

Ids are 1–40 characters of letters, digits, `-` and `_`. `read_summaries` are derived from
`read_events` on each device and never sent. Cover photo bytes, meta, the outbox and sync
bookkeeping never sync.

## Visibility

The typed tables ("views") are rebuilt from records. A row is shown only if:

- its record isn't deleted;
- every required field is present and valid;
- for loans, read events and journeys, its reader is visible (an orphan stays hidden until its
  reader arrives, and deleting a reader hides its children everywhere);
- for readers, no other visible reader has the same card token (below).

## Conflict rules

Last writer wins per field: the later stamp wins, the same on every device. On top of that:

- **Active journey.** A reader's `active_journey_id` is an ordinary field, so the later choice
  wins. A journey that lost the race (not completed, not abandoned, and not the reader's active
  one) shows as abandoned at the time it started, on every device.
- **Completion is permanent.** `completed_at` and `abandoned_at` never go back to null: set beats
  unset whatever the stamps, and within "set" the later stamp wins. A late or stale op can't undo
  a completed journey.
- **Duplicate stickers.** Two active loans with the same library and sticker (scanned twice, or
  on two devices before they synced) are both kept. The earliest `borrowed_at` (then the smaller
  id) wins; the others are flagged for a grown-up to tidy up. Nothing is deleted automatically.
- **Card-token clashes.** If two readers end up with the same card token, the one already shown
  keeps it and the incoming one is hidden (counted as a token conflict) until one of them gets a
  new token.

## Starting and joining

- **Start** (`service.start()`): a new key; an empty push claims the room (so another device can
  join at once; a key whose room already has entries is refused); then `enableSync` records this
  device's data (rows without a record get fresh stamps, recorded fields keep theirs), queues
  every field, and the engine syncs. Returns the 12 words.
- **Join, combine** (`service.join(words, 'combine')`): check the household exists (one pull of
  one entry; never creates a room) → `enableSync` → pull every entry → `applyRemote` →
  `mergeOutbox(received)`, which keeps queued only fields where this device's value is still the
  newest and the relay doesn't already have that exact op → push and pull. Rejoining with the
  same words sends nothing the relay already holds.
- **Join, replace** (`service.join(words, 'replace')`, after the UI confirms): pull every entry
  first; then `replaceWithRemote` writes the household's data, clock, cursor and key in one
  transaction. If any page fails, or the write fails, the device is left exactly as it was.
- **Empty device:** with no readers, home items, libraries or loans, a join is always a replace
  and the UI doesn't ask.
- A key that doesn't match a household fails with "No household found for these words" and saves
  nothing; a deleted household fails with `JoinError('deleted')`.

Only one tab runs the engine (a Web Lock; the others queue for it and take over when that tab
closes). Other tabs see data changes through the store's `subscribe()` and the engine's status
through a BroadcastChannel; their actions write to IndexedDB and tell the running tab.

## Backup, reset and delete under sync

- **Backups** can be made at any time; they contain the data, never the key or sync bookkeeping.
- **Restoring a backup** is refused while sync is on (`sync_enabled`): it would replace the
  household's data on every device. Turn sync off first, or join with "replace".
- **Turn off** (`stop(true)`): the device forgets the key and stops syncing; its data stays and
  the other devices keep syncing. To sync again, join with the words.
- **Turn off and clear** (`stop(false)`): as above, then `resetDevice` clears everything on this
  device (data, records, outbox, key).
- **Deleting data** (a reader, a loan…) is a tombstone that syncs like any other change.
- **Delete household** (`deleteHousehold()`): deletes the room on the relay (its log and photos).
  Local data stays on every device.

## When the household is deleted (410)

The relay keeps a marker for a deleted room and answers every request with 410, so nothing can
recreate it. The engine treats 410 from any request, a `{"type":"deleted"}` message and close code
4410 the same way: state `deleted`, the socket and timers stop, nothing is retried or re-queued,
and later triggers (online, visible, Sync now) do nothing. A device that was offline finds out on
its next request.

From there the device either keeps a local copy (`stop(true)`: sync off, data kept) or starts a
new household (`stop(true)` then `start()`: a new key and room, and this device's data is sent
again). Other devices then join the new household with its words.

## Photos (6e)

Books may point at a cover photo as `cover:<sha256>`; the photo itself doesn't sync yet. In 6e
photos will be encrypted on the device (keys from `deriveBlobKeys`) and stored on the relay under a
keyed id (`blobId`, 43 base64url characters), up to 512 KB each, 2,000 per household and 200 MB
in all.

## The accepted pairing risk

The 12 words are the household. Anyone who has them, or a photo of the QR code, can join and read
everything, and the relay can't tell a new device from an old one: there is no device approval and
no way to remove one device. This is accepted to keep sync account-free. What limits it:

- the words are shown only after a confirmation ("Anyone who sees them can read your data");
- they are never sent anywhere or logged, and the relay only ever gets values derived from them;
- if they may have leaked, delete the household and start a new one (new words), then join the
  devices again.

## Relay limits and fixes

Limits (from `relay/src/room-logic.js`): 1 MB per push request, 500 envelopes per push, 64 KB
per envelope, 200,000 entries per room, pulls of at most 500; rate limits of 120 requests at once
then 2 a second per room, photo downloads and lists 300 at once then 40 a second, wrong tokens 10
at once then one every 10 seconds; photos 512 KB each, 2,000 per room, 200 MB per room.

Changes from Peek Budget's relay, all covered by `relay/test/`:

- checks run in a fixed order (token format, deleted, token, rate limit, then the body), so a
  bad request never costs a body read or the room's allowance;
- the token is compared in constant time, and wrong tokens use their own small bucket;
- a first push claims a room only after its body checks out;
- photo reads have their own bucket, so restoring photos can't starve pushes;
- rooms can be deleted, with a permanent marker (410) and the live sockets closed (4410);
- photo endpoints with size and count limits;
- `ALLOWED_ORIGINS` is localhost only in the committed config; the real origin is set at deploy
  time (`keep_vars = true` keeps it).

The relay is not deployed yet; [relay/README.md](../relay/README.md) has the deploy notes.
