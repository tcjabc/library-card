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

> **Status: Phase 1.** Scaffolding, the storage layer, the barcode scanner, ISBN
> lookup and a developer page at `#/dev`. The reader-facing app comes later.

## Quick start (zero config)

Requires Node.js 20.19+ (CI uses 24).

```sh
npm install
npm run dev
```

Open <http://localhost:5173/#/dev>, scan a book's barcode (or type an ISBN) and
add it to Home. No `.env` file is needed.

### Testing on a phone

Phone browsers only allow the camera on secure (HTTPS) pages. Pick one:

- **LAN with a self-signed certificate:** `npm run dev:phone`, then open the
  `https://<your-computer-ip>:5173/#/dev` URL it prints and accept the
  certificate warning. Good for the scanner. The service worker won't install
  with a self-signed certificate, so test installing from GitHub Pages instead.
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
    index.ts       getDataStore(): picks the adapter from VITE_DATA_ADAPTER
    adapters/      One file per backend
  books/         ISBN validation and lookup (Open Library, then Google Books)
  scan/          Camera barcode/QR scanner
  journeys/      Reading Journey definitions (data only)
  strings/       All UI text (en.ts)
  ui/            Shared styles and components
  theme.css      Design tokens (CSS variables)
  dev/           Temporary developer page (#/dev)
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
   timestamps, ISBN-13 keys, `null` for missing values, `DataStoreError`
   codes for failures, one read per reader+ISBN, at most one active journey per
   reader.

_More detail (schemas, migrations, auth) will be added with each adapter._

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
