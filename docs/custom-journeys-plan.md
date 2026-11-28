# Custom journeys plan

A trace (2026-11-28) of custom reading journeys, with the decisions taken from it. Nothing is built
yet; the releases are at the end.

## The idea

A grown-up makes a journey from one of the eight themes (Ocean Deep, Redwood Tree, Ocean Cliff,
Skyscraper, Rapunzel's Tower, Hot-Air Balloon, Ladder to the Moon, Rocket Through Space). It has a
length of 3 to 30 books and an optional name.

- **For children:** it appears in My Journeys exactly like a built-in journey: the same scene and
  parallax, progress from first confirmed reads, the celebration at the end.
- **On paper:** it prints as a poster, with the theme's art and one numbered circle and line per
  book.
- **Who can make one:** grown-ups only, behind the gate. It's shared by the household and synced.

## Decisions

1. **One active journey per reader, as today.** "Picking which to follow" means starting one from
   the gallery. There's no multiple-active model.
2. **What a custom journey is:** theme, length (`steps`, 3–30), optional name, and `archived_at`.
   - **Theme:** one of the 8, fixed at creation and not editable.
   - **Name:** optional, editable. When missing it shows as "<Theme> · N books".
3. **The length can only be raised.** In a merge the larger length wins (a rule next to
   `MONOTONIC_FIELDS`). Raising applies to readers in progress, whose progress is worked out live.
   Finished journeys stay finished, because completion is permanent.
4. **Storage:**
   - A household table `custom_journeys`, whose local id is a UUID (sync allows at most 40
     characters).
   - A reader who starts one stores `journey_id = custom:<uuid>`, which is 43 of the 64 characters
     allowed and can never clash with a theme id.
5. **Archive, never delete.** An archived journey is hidden from the gallery, the posters and new
   starts. Readers already on it keep going, and their history keeps its name and theme. A sync
   delete (tombstone) would hide the definition and break those readers, so it's never used.
6. **Where it's made:** Grown-ups → Readers, in a "Journeys" section with a list and
   create/edit/archive. A shortcut button in Cards → Journey posters opens the same form. There's
   no new tab.
7. **Stage labels on custom journeys are scaled:** stage step × N / the theme's built-in steps,
   rounded, duplicates dropped, and the last stage on the last step.
8. **Scenes:**
   - Built-in travel stays unchanged.
   - A custom journey uses `clamp(N × 34, 100, 640)` px of travel, with the theme's layer factors.
9. **One resolver, `resolveJourney(id, customs)`, feeds everything:** status, completion,
   celebration, the Readers tab, posters and scenes.
   - The scene, art, colour and poster lookups use the theme, not the id.
   - `checkJourneyCompletion` must not silently return for a custom id.
10. **Gallery:** an "Our journeys" group above the built-ins.
11. **Posters:**
    - A custom journey's poster is its theme's art with `layoutSlots(N)`.
    - The title is the custom name; the caption keeps "My reading journey: N books".
    - Custom chips come after the eight, and "All" covers both.
    - The layout tests extend to N = 3.

## What the trace found

### The journey model

- **The built-ins:** `CONFIG` in `src/journeys/journeys.ts:34-42` gives each of the eight an emoji,
  steps, direction and stage steps. The titles and stage labels are in `strings.journeys[id]`, and
  the colour variable is built from the id (`:48-60`). There's no per-step art.
- **A reader's journey:** `reader_journeys.journey_id` is a plain string (`DataStore.ts:245-256`,
  wire limit 64 at `docs/sync.md:103`). `readers.active_journey_id` points to the reader's one
  active row (`DataStore.ts:74-77`). Starting another abandons it in the same transaction
  (`local.ts:2013-2038`).
- **Progress is never stored.** It counts confirmed first reads since `started_at`, capped at the
  definition's steps (`progress.ts:28-30`). Reads carry no journey id.
- **Everything resolves the definition with `getJourney(record.journey_id)`:** status
  (`useJourneyStatus.ts:20-27`), completion (`completion.ts:23-26`), celebration
  (`CelebrationHost.tsx:199-243`), the Readers tab (`ReadersTab.tsx:52-58`) and posters
  (`JourneyPoster.tsx:16-17`).
- **Id-keyed tables:** `SCENES` (`scene.ts:39-48`), the scene art (`JourneyScene.tsx:15-24`), the
  scene CSS classes, `POSTER_ART`.
- **With an unknown id today:**
  - Completion silently returns (`completion.ts:24`), so the journey never finishes.
  - The hub shows "pick a journey" and the journey screen redirects to the gallery.
  - Picking another journey in the gallery silently abandons it (`JourneyGallery.tsx:42-43`).

### Scenes at 3 to 30 books

- **Nothing crashes at any length.** There's one 4.5rem row per step (`JourneyScreen.tsx:57-58`),
  and the scroll range is just the page's height.
- **Travel is per theme, not per length** (`scene.ts:39-48`: Ocean Deep 200 px … Rocket 640 px),
  and a test ties it to the built-in counts (`scene.test.ts:51-61`).
  - At 30 books, Ocean Deep's 200 px would barely move.
  - At 3 books, Rocket's 640 px would jump about 128 px a step.
  - Hence decision 8 for custom journeys.
- **At 3 books** the page is barely taller than the screen, so the scene places by step
  (`scene.ts:83-110`), and the 60 px minimum glide (`:113`) is most of the travel. That's
  acceptable.
- **Unaffected by length:** the slow-device step-down (`sceneBudget.ts`) and the seen key
  `library-card:journey-seen:<readerId>:<recordId>` (`journeySeen.ts:13-14`). The key uses the
  record id, so a custom journey starts fresh.
- **There are no scene thumbnails.** Gallery and hub tiles show the emoji, title and "N books".

### Completion and celebration

- **The path:**
  - `checkJourneyCompletion` (`completion.ts:16-30`) runs after reads and from watchers.
  - `completeJourney` sets the permanent `completed_at` and clears the active pointer
    (`local.ts:2063-2077`).
  - `JourneyScreen` redirects to `/journeys` (`JourneyScreen.tsx:36-39`).
- **`CelebrationHost`** picks by record id (`celebration.ts:65-78`) and shows the definition's
  emoji, colour, title and book count. It needs the resolver for a custom title and length.
- **There's no finale animation yet**; the celebration is 6 confetti bursts
  (`CelebrationHost.tsx:16-17`). Build the finale after custom journeys, on the resolver and keyed
  by theme, so it covers custom journeys for free.

### Data and sync

- **Ids:** a household table like `collections` and `parent_notes`. Local ids are 1–40 characters
  (`src/data/sync/schema.ts:64`), and record ids `custom_journeys:<id>` stay within 64.
- **Fields on the wire:**
  - `theme`: text matching the 8 ids
  - `steps`: a whole number, 3–30
  - `name`: text up to 100, or null (missing means the default)
  - `created_at`
  - `archived_at`: or null
- **Merging:**
  - Last writer wins per field, which is fine for the name and archive fields.
  - For `steps` the larger wins. Otherwise two concurrent raises could end lower: 10→20 on one
    device and 10→15 later on another would give 15.
- **The steps for a new table** (as `parent_notes` did, commit 6da64c4):
  1. Types, `DataTable` and methods in `DataStore.ts`.
  2. In `local.ts`: `DB_VERSION` 9 → 10, an upgrade block, the store, `ALL_TABLES`.
  3. In `schema.ts`: `SYNCED_TABLES` and a `SCHEMA` entry.
  4. In `backup.ts`: the table and its fields, in `OPTIONAL_TABLES`, so an older backup restores
     with none.
  5. In `src/sync/service.ts`: the local counts.
  6. In `storageChecks.ts`: checks, plus the migration check.
  7. The method coverage list in `storage.test.ts`.
  8. Convergence, schema and backup tests.
  9. `docs/sync.md`.
- **Both adapters:** the local adapter and the same adapter wrapped for sync. The storage checks run
  on both.
- **The re-read gap is fixed in 1.24.1.** Before it, a device that didn't know a table skipped its
  ops for good. Since 1.24.1, growing `SYNCED_TABLES` makes every device re-read the household's
  log once after updating (`docs/sync.md`).
- **Older app versions before they auto-update:**
  - A child's custom journey shows as "no journey".
  - Picking another journey there abandons it, and that syncs.
  - Shipping the data layer (1.25.0) before anything can create a custom journey (1.26.0) closes
    most of that window.
- **Backups:** an older app refuses a backup from a newer schema (`backup.ts:309`), which is fine.

### Posters

- **The art doesn't depend on the length.** It's keyed by theme, and the length only feeds
  `layoutSlots`. For any N every writing line is 65.3 mm, the circles 9.5 mm, and the art clearance
  is unchanged:

  | Books | Row pitch | Same-side spacing |
  |---|---|---|
  | 3 | 70.3 mm | 140.5 mm |
  | 30 | 7.0 mm | 14.1 mm |

- **Tests** cover 5–30 today (`posterLayout.test.ts:9`).
- **`JourneyPoster`** looks the art up by `journey.id`; it must use the theme.

### The create UI

- **The form:**
  - Theme: 8 chips, each with that theme's poster line art.
  - Length: the existing `.stepper` (`LoanEditor.tsx:231`), 3–30, plus presets 5, 10, 20, 30.
  - Name: optional text, with the default as a placeholder.
  - A live poster preview.
- **Tap targets:** 44 px in Grown-ups (`--tap-target-grownup`) and 56 px for children's tiles
  (`--tap-target`).
- **Strings** in `en.ts`:
  - the Journeys section heading and intro, the "Create custom" button
  - the theme, length and name labels and help, the name placeholder
  - the default name format "{theme} · {count} books"
  - the "Can be made longer later, not shorter" note
  - save, archive and confirm-archive texts
  - the gallery's "Our journeys" title
  - an empty-state line

## Releases

1. **1.24.1:** the sync re-read fix (a new synced table means one re-read on every device).
2. **1.25.0: the data layer only** (built): Nothing user-visible creates a custom journey yet.
   - The `custom_journeys` table and the v10 upgrade, with the archive field.
   - The `resolveJourney` refactor, with identical behaviour for built-ins.
   - Larger-wins for `steps`.
   - Backup and storage checks.
   - Convergence, schema and backup tests.
   - `docs/sync.md`.
3. **1.26.0: what children and grown-ups see** (built):
   - The create UI in Grown-ups → Readers (and the poster shortcut).
   - My Journeys: the gallery group, hub, journey screen, scene travel from N, scaled stages.
   - Completion and celebration through the resolver.
   - Posters for custom journeys.

**Bundle estimate:** about +1–2 KB gzipped at startup (adapter, schema, resolver), +2–4 KB in the
Grown-ups chunk (the form), about +0.3 KB in the posters chunk.

Found while building 1.26.0: confetti in an open dialog used the `:modal` selector, which Chrome
only reads from 105 (Safari from 15.4). On Chrome 103 every celebration threw and the app went
blank, built-in journeys too, since collections in 1.6.0. The fix (`isModal` in
src/ui/confetti.ts) treats an open dialog as modal where `:modal` is unknown.

