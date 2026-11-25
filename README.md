# Library Card

A reading tracker for kids, built as an installable web app (PWA).

- Each child has a QR **library card**.
- Two libraries: **Home** (books you own, with a per-child "I read this!") and
  **Borrowed** (library loans with an optional due date).
- Reads drive **Reading Journeys** (each reader picks one and climbs it until
  it's done) and a shared **Family Staircase** (an endless staircase of
  everyone's reads).

The repo has no personal data, accounts or seed content. By default
everything is stored on the device in IndexedDB.

> **Status: Phase 4.** Library-card sign-in, the kid hub, My Bookshelf,
> Library Books (borrow by scanning the book and the library sticker, renew,
> return, re-read), Reading Journeys with a celebration at the finish, and the
> Family Staircase. Grown-up tools (readers and cards, books, libraries, loans)
> live on a gated page at `#/dev` until the full grown-up area arrives.

## Quick start (zero config)

Requires Node.js 20.19+ (CI uses 24).

```sh
npm install
npm run dev
```

Open <http://localhost:5173/#/dev> ("Grown-ups" on the start screen):

1. Create a reader. Each reader gets a QR library card.
2. Scan a book's barcode (or type an ISBN) and add it to Home.
3. Scan the card (or tap "Open card") to reach the reader's hub and bookshelf.

No `.env` file is needed.

### Testing on a phone

Phone browsers only allow the camera on secure (HTTPS) pages. Pick one:

- **LAN with a self-signed certificate:** `npm run dev:phone`, then open the
  `https://<your-computer-ip>:5173/` URL it prints and accept the
  certificate warning. Good for the scanner. The service worker won't install
  with a self-signed certificate, so test installing from GitHub Pages instead.
  Each address (LAN, Pages) has its own separate on-device data.
- **GitHub Pages:** push to `main` and use the deployed site (see below).

## Scripts

| Script                        | What it does                                        |
| ----------------------------- | --------------------------------------------------- |
| `npm run dev`                 | Dev server on localhost                             |
| `npm run dev:phone`           | Dev server on your LAN over self-signed HTTPS       |
| `npm run build`               | Type-check and build to `dist/` (includes the service worker) |
| `npm run preview`             | Serve the production build locally                  |
| `npm run lint`                | ESLint                                              |
| `npm test`                    | Unit and storage tests (Vitest, Node, fake IndexedDB) |
| `npm run test:watch`          | The same, re-run on every change                    |
| `npm run test:relay`          | The sync relay's tests (after `npm install --prefix relay`) |
| `npm run generate-pwa-assets` | Regenerate app icons from `public/favicon.svg`      |

## Configuration

Copy `.env.example` to `.env.local` (git-ignored) to change defaults.

| Variable                    | Default | Purpose                                               |
| --------------------------- | ------- | ----------------------------------------------------- |
| `VITE_DATA_ADAPTER`         | `local` | Storage backend (see below)                           |
| `VITE_SYNC_RELAY_URL`       | none    | The sync relay's URL (with `VITE_DATA_ADAPTER=sync`)   |
| `VITE_BASE`                 | `/`     | Public base path, e.g. `/library-card/` for Pages     |
| `VITE_GOOGLE_BOOKS_API_KEY` | empty   | Optional; raises the Google Books fallback rate limit |
| `VITE_SUPABASE_URL`         | none    | Reserved for the Supabase adapter                     |
| `VITE_SUPABASE_ANON_KEY`    | none    | Reserved for the Supabase adapter                     |

All `VITE_*` values end up in the public JavaScript bundle. Never put secrets
in them.

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` lints, tests, builds and deploys.
   A failing test stops the deploy.

**Versions.** `package.json`'s version is shown in Grown-ups → Settings → About, with the commit
and build time. Bump the minor version for each feature release and the patch version for fixes,
in the release commit (`npm version 1.1.0 --no-git-tag-version`). 1.0.0 is the first full release
(sync, household PIN, card maker).

After changing a manifest field (the `manifest` block in `vite.config.ts`: name, icons,
colours, orientation…), reinstall the app on each device: installed apps can keep the old
manifest for a long time (Android updates its installed copy on its own schedule). Download a
backup first (Grown-ups → Settings), and if removing the app offers to clear the site's data
too, leave that unticked.

The workflow sets `VITE_BASE` to `/<repo-name>/`. For a user site
(`<name>.github.io`) or a custom domain, add a repository variable
`VITE_BASE` = `/` under **Settings → Secrets and variables → Actions → Variables**.
`VITE_DATA_ADAPTER` and `VITE_GOOGLE_BOOKS_API_KEY` can be set the same way.

Routing uses hash URLs (`#/dev`), so no 404 redirects are needed.

## Offline and caching

The service worker (vite-plugin-pwa, `vite.config.ts`) keeps the app working
offline:

- The app shell, icons and the barcode decoder (ZXing WASM) are precached.
- Catalogue cover images are cached at runtime in the `book-covers` cache,
  cache-first: `covers.openlibrary.org` (and `archive.org`, where Open Library
  redirects), `books.google.com` and Google's `*.googleusercontent.com` image
  hosts. A cover seen once shows offline. The cache holds at most 300 images,
  each for up to 60 days, and is cleared first if the browser runs short of
  space. Cross-origin `<img>` responses are opaque, so those are cached too.
- Cover photos taken in the app are stored in IndexedDB, not in this cache.
- At start-up the app asks for persistent storage (`navigator.storage.persist()`),
  so the browser is less likely to clear books and photos. A refusal is ignored.

## Project layout

```
src/
  data/          Storage. Feature code imports from here only.
    DataStore.ts   The storage interface and entity types
    index.ts       getDataStore(), useDataQuery(), hashPin()/verifyPin()
    pin.ts         Parent PIN hashing shared by every adapter
    selftest.ts    In-app storage self-test (run from #/dev)
    testing/       Storage checks shared by the self-test and Vitest
    adapters/      One file per backend
  books/         ISBN validation, lookup and the add / fix book sheet
  cards/         Library card QR URLs
  scan/          Camera scanner (QR mode and book mode)
  session/       The active reader on this device
  screens/       Kid screens: splash, card sign-in, hub, bookshelf, library,
                 journeys/ (gallery, journey track, celebration, staircase)
  sync/vendor/   Vendored sync core, recovery words and crypto (see VENDORED.md)
  journeys/      Journey config (journeys.ts) and pure, unit-tested helpers:
                 progress, staircase layout, completion check, celebration flag
  lib/           Small helpers: dates, text, image resizing
  strings/       All UI text (en.ts)
  ui/            Shared styles and components
  theme.css      Design tokens (CSS variables)
  dev/           Temporary grown-up tools (#/dev)
```

## Storage adapters

Everything in the app talks to the `DataStore` interface in
`src/data/DataStore.ts`. Adapters implement it for a particular backend, and
`src/data/index.ts` picks one at build time from `VITE_DATA_ADAPTER`. An ESLint
rule stops feature code from importing an adapter directly.

| Adapter    | `VITE_DATA_ADAPTER` | Status    | Notes                                     |
| ---------- | ------------------- | --------- | ----------------------------------------- |
| IndexedDB  | `local`             | Available | Default. Data stays on the device.        |
| IndexedDB + sync | `sync`        | Available | `local` plus end-to-end encrypted sync through the relay (needs `VITE_SYNC_RELAY_URL`). |
| Supabase   | `supabase`          | Planned   | Sync across devices. Needs RLS policies.  |
| Cloudflare D1 | `d1`             | Planned   | Via a small Worker API.                   |

### Writing an adapter

1. Create `src/data/adapters/<name>.ts` exporting an async factory that returns
   a `DataStore`.
2. Register it in the `ADAPTERS` map in `src/data/index.ts`.
3. Follow the conventions at the top of `DataStore.ts`: ISO 8601 UTC
   timestamps, `YYYY-MM-DD` due dates, book keys (ISBN-13, or `noisbn-<id>`),
   `null` for missing values, and `DataStoreError` codes for failures.
4. One household per device, with the id `HOUSEHOLD_ID` (`"main"`).
   `getCurrentHousehold()` creates it on first use. There is no create, list or
   delete for households.
5. Home items: one per household and book, and the item id is the book key.
   Libraries default to `DEFAULT_LOAN_DAYS` (30). Deleting a library keeps its
   loans: `library_id` becomes `null` and the library's name is copied onto each
   loan. `renewLoan()` adds the library's loan length to the due date;
   `unrenewLoan()` and `unreturnLoan()` undo renew and return.
   `findActiveLoansBySticker()` searches the whole household; when it finds more
   than one, `pickStickerWinner()` decides (earliest `borrowed_at`, then
   smallest id) and nothing is deleted automatically.
6. Reads are events: every `markRead()` adds one (re-reads count), except that a
   tap within `READ_TAP_GUARD_MS` (10 s) of the reader's latest read of that
   book returns `null`. `undoLatestRead()` removes the latest event (latest
   `read_at`, then id), and `restoreReadEvent()` puts one back with the same id.
7. Keep a read summary per reader and book (`first_read_at`, `last_read_at`,
   `count`) up to date in the same transaction as every event change.
   `countReadsSince()` counts books by their first read, and
   `countHouseholdReads()` counts reader and book pairs. Both are indexed counts.
8. At most one active journey per reader, held in `readers.active_journey_id`.
   `startJourney()`, `completeJourney()` and `deleteReaderJourney()` keep it
   right. Starting a journey while another is active stops the old one first
   (sets its `abandoned_at`) in the same transaction. `getActiveJourney()`
   returns `null` for a missing, completed or abandoned journey. Completion is
   permanent: `completeJourney()` keeps the first `completed_at`, and undoing
   reads never clears it. Records stored before `abandoned_at` existed read it
   as `null`.
9. Every delete removes one record by id; cascades delete each child row.
10. Call `subscribe()` listeners after every write, including writes from other
    tabs or devices (`remote: true`).
11. `saveCoverImage()` stores a photo of at most `MAX_COVER_BYTES` (512 KB) and
    returns a `cover_url`. The local adapter keeps photos by content as
    `cover:<sha256>` and hands out session-only `blob:` URLs, which are never
    persisted. A photo is deleted once no book uses it.
12. Store `parent_pin_hash` exactly as `hashPin()` returns it.
13. Collections: a book is in at most one, through its `collection_id` and
    `volume`; `putBook()` never changes them. `setBookCollection()` puts one book
    in a set; `setBooksCollection()` puts several (checked first, then one
    transaction and one change notification), skips books that no longer exist,
    and puts each one at Home if it is only borrowed. `deleteCollection()` keeps
    the books and unlinks them in one transaction.

After changing the local adapter, run `npm test`. The storage checks in
`src/data/testing/` also run in the app (`#/dev`, Storage self-test), which is
worth doing on real phones: their IndexedDB differs from the fake one in Node.
Both run on throwaway databases, including real v1 to v3 and v2 to v3 migrations.

_Schemas, migrations and auth for hosted adapters will be added with each one._

## Sync between devices

With `VITE_DATA_ADAPTER=sync` and `VITE_SYNC_RELAY_URL`, Grown-ups → Settings → Sync devices
keeps one household the same on several devices: changes, cover photos (encrypted, in 16 KB size
buckets, at most 512 KB each), the household's time zone (every "today" and due-date chip counts
in it) and journey completions (each device celebrates a finished journey once). There are no
accounts: a household is 12 words, shown as a QR code to add a device. Everything is encrypted on
the device; the relay sees only ciphertext. [docs/sync.md](docs/sync.md) has the design.

**Write the 12 words down** when you start syncing (the app asks you to tick that you have) and
keep them somewhere safe: they are the only way back in if you forget the PIN or lose your devices.

**Household PIN.** Starting sync also sets a household PIN (4–6 digits), synced to every device.
It is asked before adding a device (which shows the words), turning off sync, deleting the
household, resetting a device, restoring a backup, and changing the PIN; the "grown-ups only"
question still guards everything else. Wrong PINs make you wait (30 s after 5, doubling up to
15 minutes). Forgot it? Type the 12 words in Settings → Household PIN → Forgot the PIN. Without
sync, a PIN is optional and can be removed after a one-minute wait.

### Switching Pages to sync

The relay is deployed and the repository variable `VITE_SYNC_RELAY_URL` is set; Pages still builds
with `VITE_DATA_ADAPTER=local` (no sync UI). To switch:

1. Check the relay's allowed origins include the Pages origin (relay/README.md, "Deploy").
2. Add the repository variable `VITE_DATA_ADAPTER` = `sync` under **Settings → Secrets and
   variables → Actions → Variables**.
3. Re-run the deploy workflow (or push to `main`). Existing devices keep their data: the sync
   adapter uses the same database and only adds sync bookkeeping. Sync stays off on each device
   until a grown-up starts or joins a household.

To switch back, set the variable to `local` and deploy again: data stays on each device; a device
that was syncing simply stops.

## Sync relay

`relay/` is its own package: a Cloudflare Worker (Durable Objects for each
household's change log, R2 for cover photos) that passes **encrypted** changes
and photos between a household's devices. It stores ciphertext only: sealed
envelopes, their ids and timestamps, and encrypted photo bytes. It never sees
the household key, book titles, children's names or reading history. It was
copied from Peek Budget's relay and changed (see [VENDORED.md](VENDORED.md));
[relay/README.md](relay/README.md) has the API, limits and what the relay can see.

Run it locally (no Cloudflare account needed):

```sh
npm install --prefix relay
npm run dev --prefix relay      # wrangler dev on http://localhost:8787
npm run test:relay              # its tests, run locally in workerd
```

Deploying: create the R2 bucket (`npx wrangler r2 bucket create
library-card-blobs`), set `ALLOWED_ORIGINS` once as a Worker secret
(`npx wrangler secret put ALLOWED_ORIGINS`; it is not in `wrangler.toml`), then
`npx wrangler deploy` from `relay/` (plain, every time). relay/README.md has
the steps. CI runs the relay tests before building the app, so a relay failure
blocks the deploy.

## Privacy

- No analytics, no accounts, no seed data.
- With the `local` adapter, nothing leaves the device except ISBN lookups to
  Open Library and Google Books, and cover image requests.
- Library cards hold a random token, never a name.

## Browser support

The scanner uses the native `BarcodeDetector` where it exists (Chrome on
Android) and the [`barcode-detector`](https://github.com/Sec-ant/barcode-detector)
polyfill (ZXing compiled to WebAssembly) elsewhere, including iOS Safari. The
WASM file is bundled and precached, so scanning works offline.

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 tcjabc.

Some files come from other projects under their own licences, with the full
texts in [LICENSES/](LICENSES):

- The sync core, recovery words and sync crypto in `src/sync/vendor/` come from
  Peek Budget (MIT), some verbatim and one changed. [VENDORED.md](VENDORED.md)
  lists each file, where it came from and its SHA-256.
- The BIP-39 English wordlist (MIT; the npm copy it was taken from is ISC).
