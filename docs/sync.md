# Sync between devices

How Library Card keeps one household's data the same on several devices. The engine, crypto and
relay are adapted from Peek Budget (MIT); [VENDORED.md](../VENDORED.md) lists every copied file,
its upstream hash and what changed.

Status: the record layer (6c), the engine and its service (6d-1), the relay (6b), the
"Sync devices" screens (6d-2), and cover photos, the household time zone and celebrations under
sync (6e) exist. The sync UI appears only in a build with the sync adapter **and** a relay
(`VITE_DATA_ADAPTER=sync` and `VITE_SYNC_RELAY_URL`); the Pages build stays on
`VITE_DATA_ADAPTER=local` until that repository variable is switched (README, "Switching Pages to
sync").

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
| Service | `src/sync/service.ts` | Runs the engine in one tab, maps its status for the UI, and offers `start`, `join`, `stop`, `deleteHousehold`, `syncNow`, `localCounts`. |
| App wiring | `src/sync/app.ts`, `useSync.ts` | One service for the app, started in `main.tsx` (so changes sync while the kids use the app), loaded lazily and only when sync is enabled in the build. |
| Screens | `src/grownups/sync/` | Grown-ups → Settings → Sync devices, and a small status note in the grown-up header. Kid screens never show sync. |
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
| `households` | `main` | **name** (text ≤ 200), parent_pin_hash (text ≤ 300; never sent while unset), time_zone (text ≤ 64; never sent while unset) |
| `readers` | id | **display_name** (≤ 200), **avatar** (≤ 32), **card_token** (≤ 200), active_journey_id (id or null) |
| `books` | ISBN-13 or `noisbn-<id>` | **title** (≤ 1000), **authors** (≤ 50 texts of ≤ 300), cover_url (≤ 4096 or null), **source** (≤ 32) |
| `home_items` | book key | **isbn** (book key), **added_at** (timestamp) |
| `libraries` | id | **name** (≤ 200), search_url_template, homepage_url (≤ 4096 or null), **default_loan_days** (1–3650), sticker_prefix (≤ 64 or null) |
| `loans` | id | **reader_id**, **isbn**, library_id, library_name (≤ 300), sticker_barcode (≤ 200), **borrowed_at**, due_date (YYYY-MM-DD or null), returned_at, **renew_count** (0–100,000) |
| `read_events` | id | **reader_id**, **isbn**, **read_at** |
| `reader_journeys` | id | **reader_id**, **journey_id** (≤ 64), **started_at**, completed_at, abandoned_at |

Ids are 1–40 characters of letters, digits, `-` and `_`. `read_summaries` are derived from
`read_events` on each device and never sent. Cover photo bytes travel separately, as encrypted
blobs (Photos, below); meta, the outbox, the photo outbox, the celebrated list and sync bookkeeping
never sync.

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

Only one tab runs the engine (a Web Lock, `library-card-sync-engine`; the others queue for it).
Other tabs see data changes through the store's `subscribe()` and the engine's status through a
BroadcastChannel; their actions write to IndexedDB and tell the running tab.

**Hand-off.** Only a visible tab takes the engine lock. When the running tab is hidden
(`visibilitychange`), frozen (`freeze`; Android freezes background tabs) or unloaded (`pagehide`),
it does one quick last sync (at most 1.5 s), stops its engine, releases the lock and queues again
once it is visible. A visible tab that was waiting takes over at once, so a frozen tab can never
hold sync up. A tab that doesn't run sync and hasn't heard from the one that does for 4 s says
"Syncing in another tab" instead of "Connecting…".

**One household action at a time.** `start`, `join`, `stop` and `deleteHousehold` take a second
Web Lock (`library-card-sync-action`, if available) and an in-tab flag. A second call, in this tab
or another, fails at once with `SyncBusyError`; while one runs, the other tabs' status has
`busyElsewhere` and the screen says "Busy in another tab". (A tab that closes mid-action is
forgotten after two minutes.)

**What a replace drops.** `localCounts()` counts this device's readers, home books, libraries,
loans and reads (every read event, re-reads included). The join screen shows them before
"Use the household's data only", and a device where they are all 0 joins as a replace without
asking.

### The screens (Grown-ups → Settings → Sync devices)

- **Off:** "Start syncing this household" (on a device that was in a household before, it warns
  first: the old household's devices won't see this one) and "Join a household". Starting asks for
  the household PIN first (a new one, entered twice; or the current one if this device has one),
  then shows the 12 words with "Write these 12 words down…" and an "I've written them down" tick
  before Continue.
- **Join:** scan the other device's code (the pairing scanner accepts only 12 valid words) or type
  the words in 12 numbered boxes (word-list suggestions, a "did you mean" for typos, a pasted list
  fills the boxes; the checksum is checked on Continue). Then, if this device has data,
  "Combine with this device's data" (the default) or "Use the household's data only" (a confirm
  with the counts).
- **On:** the status (Live / Checking every few minutes / Offline / Error, last synced, changes
  waiting), Sync now, Add a device, Turn off sync on this device, Delete household from all devices
  (type DELETE). Add a device, Turn off and Delete ask for the household PIN (below).
- **Add a device:** the QR code (the 12 words only) and the words in a numbered grid, with the
  risk ("Anyone who sees or photographs this can open your household"). It closes when the page is
  hidden or left; the words can't be selected, and nothing is printed, shared or copied.
- **Removed:** "This household was removed", with "Keep a copy on this device" (turn sync off) or
  "Start a new household".
- The kids' card scanner says "That's a grown-up code" for a pairing code and keeps scanning.

## Backup, reset and delete under sync

- **Backups** can be made at any time; they contain the data, never the key or sync bookkeeping.
- **Restoring a backup** is refused by the store while sync is on (`sync_enabled`): it would
  replace the household's data on every device. With sync on (or the household removed), Settings
  explains this and offers "Turn off sync, then restore" (this device leaves the household and gets
  the backup) or "Start a new household from this backup" (leave, restore, then start a new
  household with it).
- **Turn off** (`stop(true)`): the device forgets the key and stops syncing; its data stays and
  the other devices keep syncing. It remembers that it was in a household (`was_paired`, with the
  time), so "Start a new household" warns first. To sync again, join with the words.
- **Reset this device** with sync on (`stop(false)`): this device leaves the household (the others
  keep it and their data), then `resetDevice` clears everything here (data, records, outbox, key).
  `was_paired` is written again after the reset.
- **Reset this device** and **Use the household's data only** (`replaceWithRemote`) also clear the
  photo outbox; turning sync on (`enableSync`) clears it too, so every photo is checked again.
- **Restoring a backup** keeps working as before (photos are in the file). Afterwards every
  journey it holds is marked celebrated on this device.
- **Deleting data** (a reader, a loan…) is a tombstone that syncs like any other change.
- **Delete household** (`deleteHousehold()`): deletes the room on the relay (its log and photos).
  Local data stays on every device.

## When the household is deleted (410)

The relay keeps a marker for a deleted room and answers every request with 410, so nothing can
recreate it. The engine treats 410 from any request, a `{"type":"deleted"}` message and close code
4410 the same way: state `deleted`, the socket and timers stop, nothing is retried or re-queued,
and later triggers (online, visible, Sync now) do nothing. A device that was offline finds out on
its next request. Photo traffic stops too: a 410 on any photo request, or the engine's `deleted`,
stops uploads, downloads and their retry timers, and no photo request is made after that.

The service remembers it in meta (`sync_deleted`, with the time), so after a reload the screen
shows "removed" at once and the engine isn't started (no request to the relay). Only two things
clear it: "Keep a copy on this device" (`stop(true)`: sync off, data kept) and "Start a new
household" (`start()`: a new key and room, and this device's data is sent again). Joining another
household is refused until one of those has happened. Other devices then join the new household
with its words.

## Photos

A book with a photo cover stores `cover_url = "cover:<sha256>"` and the photo in `cover_images`
(keyed by the hash). Catalogue covers stay plain URLs and are never uploaded. Photos move only in
the tab that runs sync (`src/sync/photoSync.ts`), only while sync is on.

**Sealing** (`src/sync/photos.ts`). AES-GCM-256 with the household's blob key (`deriveBlobKeys`,
HKDF info `library-card/v1/blob-encryption`), a random 12-byte IV, and the relay id as additional
data, so a blob can't be moved to another id. The relay id is `blobId(blobIdKey, sha256)`: the
same photo gets the same id in one household and an unrelated one anywhere else.

```
sealed    = iv (12) | AES-GCM(plaintext) incl. 16-byte tag
plaintext = "LCP1" | type length (1) | type | photo length (4, big-endian) | photo | zero padding
```

The sealed size is rounded up to a multiple of 16 KB, so the relay sees size buckets rather than
exact sizes, and is at most 512 KB (the relay's limit). New cover photos are re-encoded to at most
480 KB (`COVER_TARGET_BYTES`), so every one fits once sealed. A photo saved before that, or
restored from a backup, may be up to 512 KB; if it doesn't fit once sealed it fails as "too
large" without being sent.

**Upload.** The sync adapter keeps a photo outbox, `blob_outbox` in a separate IndexedDB database
(`<db>:sync-blobs`), one entry per photo: `pending`, `uploaded` or `failed`, with attempts, next
retry time and error. A photo with no entry is waiting. The photos to send are the ones a book
points at, that are on this device and not uploaded or failed. After every good sync (the room
exists), the running tab lists the room's photos once, marks those already there as uploaded,
and seals and `PUT`s the rest:

- 200: uploaded; the engine syncs again at once for the changes that were waiting.
- 413 (too large) or 507 (the household's 200 MB / 2,000 photos are full): `failed`, never retried.
  Sync devices shows "Some photos couldn't sync (n)"; those covers stay on this device only.
- 410: the household was deleted (above).
- Anything else, or offline: retried with backoff, 2 s doubling to at most 5 minutes, with jitter.

**Photos before the changes that use them.** `pendingOps` holds back a book's `cover_url` change
while its photo is on this device and waiting, so another device never gets a cover it can't fetch
yet. Every other field of the book goes at once, and a failed photo never holds anything: its
cover change goes out (the other devices show no cover for it).

**Download.** When a screen shows a book whose `cover:<hash>` isn't on this device, the store
reports it (`onMissingPhoto`; other tabs pass it to the running tab). The running tab `GET`s the
blob (photo reads have their own rate bucket on the relay), opens it, checks its SHA-256 against
the hash, stores it in `cover_images` (marked uploaded, so it is never sent back) and the cover
appears. Until then the book shows no cover. A 404 (not uploaded yet) or a failed check is retried
on its own with backoff, 5 s doubling to at most an hour; showing the cover again doesn't fetch
sooner.

Saving a book whose photo hasn't arrived yet (the book sheet sends no cover, because none was
shown) keeps the household's `cover:<hash>`, so an edit on one device can't remove the photo on
the others.

**What's left on the relay.** Photos stay on the relay when a book stops using them; they go when
the household is deleted.

## Household time zone

`households.time_zone` is an IANA name (`Asia/Taipei`), synced like the household's name. Every
"today" in the app counts in it: due-soon and overdue chips, the hub badge, the default due date
when borrowing, renewing, the loan editor's "not in the future" checks and the developer page's
pretend date. Borrowed and returned dates in the loan editor convert in it too (a changed date is
stored as noon there). Due dates stay plain `YYYY-MM-DD`. So a book due today shows the same chip
on every device, wherever each device is.

- Unset (`null`) means this device's zone. An unset zone is never sent, so a device joining with
  Combine can't wipe out the household's.
- Starting sync sets it to the first device's zone if it isn't set, before the first push. After a
  device joins (or on the first good sync of an older household), a household still without one
  gets that device's zone.
- Grown-ups → Settings → Time zone changes it (a searchable list; "Use this device's").
- `src/lib/timezone.ts` does the arithmetic with `Intl` (no library); `HouseholdTimeZone` keeps the
  current zone for `todayLocal()` and `useToday()`.

## Celebrations

A finished journey is celebrated once per device. Each device keeps a list of the
`reader_journeys` ids it has celebrated (`library-card:celebrated` in localStorage): local only,
never synced, never in a backup, cleared by Reset this device. A completed journey that isn't on
the list celebrates the next time its reader is active on this device, wherever it was finished
(here, another tab, or another device through sync), oldest first.

So nothing replays, every completion that already exists is added to the list first when this
version first runs, when a device starts syncing or joins, after "Use the household's data only",
and after restoring a backup. While a join or replace runs, celebrations are paused in every tab
(a localStorage flag that expires after two minutes if a tab dies).

The previous version's per-reader "celebrate" flag is migrated on first run: a celebration that
was still waiting stays due.

## Household PIN

The "grown-ups only" gate (a multiplication question) keeps children out of Grown-ups. A few
actions reach beyond this device or can't be undone, so they also ask for the household PIN:
**Add a device** (it shows the 12 words), **Turn off sync on this device**, **Delete household
from all devices**, **Reset this device**, **Restore from backup**, and **Change / Remove PIN**
(`src/grownups/pinPolicy.ts`). Everything else needs the gate only. A local-only household
without a PIN behaves as before.

- **Stored** in `households.parent_pin_hash` as `pbkdf2-sha256$<iterations>$<salt>$<hash>`
  (Web Crypto, 16-byte salt, 256-bit hash; `src/data/pin.ts`). New hashes use 300,000 iterations,
  measured at about 77 ms on a Mi 9T (2019 mid-range phone, Chrome) and 45 ms on a desktop; the count is in the hash, so
  it can change later and older hashes keep verifying. Counts outside 1,000–5,000,000 are refused,
  so a synced value can't make verifying hang. The PIN itself is never stored or sent.
- **Synced** like any household field (last writer wins). An unset PIN is never sent, and
  `clearHouseholdPin` is refused with `blocked` while sync is on, so a synced household always
  keeps one (it can be changed). `updateHousehold` doesn't take it: only `setHouseholdPin`,
  `verifyHouseholdPin` and `clearHouseholdPin` touch it. It is in backups (as the hash).
- **Joining** gives the device the household's PIN: just before the join, the device's own PIN
  is set aside (its row value, recorded field and queued change), so the household's arrives
  whatever the timestamps; if the join fails it is put back. Nothing extra to set.
- **Asked** on the gate's big number pad with masked dots. A right PIN unlocks those actions for
  2 minutes within the current grown-up session (a confirm flow doesn't ask twice); leaving
  Grown-ups, or passing the gate again, ends it.
- **Wrong PINs**, per device (localStorage, survives reloads, cleared by Reset this device): the
  first 4 cost nothing, the 5th means a 30-second wait, and each further wrong PIN doubles it, up to
  15 minutes. A right PIN starts over.
- **A synced household with no PIN** (started before the PIN existed): entering Grown-ups asks
  once per session to set one (with the write-down step); the guarded actions ask to set one first.
- **Settings → Household PIN:** Set (when there is none), Change (asks the current one), Remove
  (local-only households; asks the current one), Forgot the PIN.
- **Forgot the PIN:** a syncing device types the 12 words (the same word boxes as Join); they
  must be this device's household key, then a new PIN is chosen. A local-only household: after the
  gate, a 1-minute countdown (cancellable), then the PIN is removed.

The PIN is a door, not a lock: anyone with the 12 words is the household, and a 4–6 digit PIN can
be brute-forced by someone who has its hash (only inside the encrypted records, or a backup file).

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
- `ALLOWED_ORIGINS` is not in the committed config: on Cloudflare it is a Worker secret (set once
  with `wrangler secret put`, so no deploy can reset it), locally it comes from `relay/.dev.vars`
  (localhost only), and the tests pass it to the Worker themselves. Without it the relay refuses
  every browser request (fail closed).

The relay is deployed as a Cloudflare Worker (6d-2); [relay/README.md](../relay/README.md) has the deploy steps. Deploys are plain `npx wrangler deploy`.
