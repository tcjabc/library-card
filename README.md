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
| `npm run generate-pwa-assets` | Regenerate app icons from `public/favicon.svg`      |

## Configuration

Copy `.env.example` to `.env.local` (git-ignored) to change defaults.

| Variable                    | Default | Purpose                                               |
| --------------------------- | ------- | ----------------------------------------------------- |
| `VITE_DATA_ADAPTER`         | `local` | Storage backend (see below)                           |
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

After changing the local adapter, run `npm test`. The storage checks in
`src/data/testing/` also run in the app (`#/dev`, Storage self-test), which is
worth doing on real phones: their IndexedDB differs from the fake one in Node.
Both run on throwaway databases, including real v1 to v3 and v2 to v3 migrations.

_Schemas, migrations and auth for hosted adapters will be added with each one._

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
