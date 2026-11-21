# Library Card

A reading tracker for kids, built as an installable web app (PWA).

- Each child has a QR **library card**.
- Two libraries: **Home** (books you own, with a per-child "I read this!") and
  **Borrowed** (library loans with an optional due date).
- Reads drive **Reading Journeys** (each reader picks one and climbs it until
  it's done) and a shared **Household Journey** (an endless staircase of
  everyone's reads).

The repo has no personal data, accounts or seed content. By default
everything is stored on the device in IndexedDB.

> **Status: Phase 2.** Library-card sign-in, the kid hub and My Bookshelf with
> "I read this!". Grown-up tools (readers, cards, adding and fixing books) live
> on a temporary page at `#/dev` until the PIN-protected area arrives.

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
3. Push to `main`. `.github/workflows/deploy.yml` lints, builds and deploys.

The workflow sets `VITE_BASE` to `/<repo-name>/`. For a user site
(`<name>.github.io`) or a custom domain, add a repository variable
`VITE_BASE` = `/` under **Settings → Secrets and variables → Actions → Variables**.
`VITE_DATA_ADAPTER` and `VITE_GOOGLE_BOOKS_API_KEY` can be set the same way.

Routing uses hash URLs (`#/dev`), so no 404 redirects are needed.

## Project layout

```
src/
  data/          Storage. Feature code imports from here only.
    DataStore.ts   The storage interface and entity types
    index.ts       getDataStore(), useDataQuery(), hashPin()/verifyPin()
    pin.ts         Parent PIN hashing shared by every adapter
    selftest.ts    Storage self-test (run from #/dev)
    adapters/      One file per backend
  books/         ISBN validation, lookup and the add / fix book sheet
  cards/         Library card QR URLs
  scan/          Camera scanner (QR mode and book mode)
  session/       The active reader on this device
  screens/       Kid screens: splash, card sign-in, hub, bookshelf
  journeys/      Reading Journey definitions (data only)
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
   right. `getActiveJourney()` returns `null` for a missing or completed journey.
9. Every delete removes one record by id; cascades delete each child row.
10. Call `subscribe()` listeners after every write, including writes from other
    tabs or devices (`remote: true`).
11. `saveCoverImage()` stores a photo of at most `MAX_COVER_BYTES` (512 KB) and
    returns a `cover_url`. The local adapter keeps photos by content as
    `cover:<sha256>` and hands out session-only `blob:` URLs, which are never
    persisted. A photo is deleted once no book uses it.
12. Store `parent_pin_hash` exactly as `hashPin()` returns it.

Run the self-test on `#/dev` after changing the local adapter. It runs on
throwaway databases, including real v1 to v3 and v2 to v3 migrations.

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
