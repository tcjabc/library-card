# The Family Staircase

The hub's **Family Staircase** tile opens `#/staircase`: one pile of books for the whole household,
newest on top. The screen opens on the newest book; scrolling down goes back in time.

Code: `src/screens/journeys/FamilyStack.tsx` (the screen, loaded on its own), `src/staircase/CanvasStack.tsx`
(the canvas renderer, shared with the developer tools' pretend piles at `#/dev/stack`) and the pure helpers in
`src/staircase/stackItems.ts` (unit-tested). The bar under the pile opens the book sheet
(`src/screens/journeys/BookDetailsSheet.tsx`; see "The book sheet" below). The old zig-zag staircase is still at `#/staircase/old`, linked from
Developer tools, until it's retired.

## What's on the pile

- **One book on the pile = one reader + one book**: that reader's first **confirmed** read of it (a read
  summary). Pending reads (waiting for a grown-up) are not on the pile. The same title read by two readers is on
  the pile twice. Grown-ups' reads count.
- **Order and step numbers**: the same rule as before (`staircaseOrder`): by `first_read_at`, then reader id, then
  ISBN. Step 1 is the bottom of the pile; step N is the household's Nth first read. The total in the title is the
  number of books on the pile.
- A read confirmed later keeps its own `read_at`, so it can land in the middle of the pile. Each book's size comes
  from the book itself (its ISBN and its cover's shape, below), never its step, so the books above it don't change.
  With "Cover shapes" off, sizes are seeded by reader + ISBN as before 1.13.0.
- **Spines**: the colour comes from a hash of the ISBN; the band and avatar are the reader's (the reader colours
  `--reader-1` … `--reader-8`, assigned as on the old staircase). A missing title shows "A book"; covers aren't used.
- Counting elsewhere (milestones, the hub's total, journeys) is unchanged: no data, DataStore or sync changes.

## Where the pile sits

The book at the **eye line** (the middle of the pile's area) is the one being looked at; the bar under the pile
names it.

- **The camera's range is always [0, N - 1]**, for every pile of two or more books: scrolling, flicks, the eased
  camera, settle and the arrow keys work the same for a short pile as for a tall one. With one book (or none)
  there is nothing to scroll.
- **K** is how many books fit between the eye line and the top of the area, worked out from the area's height and
  the pitch of the thickest book (so any K + 1 books fit, whatever their sizes and turns), less the room the gap's
  lifted books take (below). With cover shapes the thickest book is 28 × 1.135 (about 31.8) with the footprint whose
  diagonal is longest (the tallest cover's), instead of the old 42-unit preset, so more books fit: K is 8 on a phone
  (was 5) and 6 in tablet landscape (was 4), gap included. The half sheet's stop (`eyeLineReach`) uses the same book.
  K only decides where the pile **starts**:
  - **A pile that fits (N - 1 <= K)** opens on its base book (step 1) at the eye line, the pile rising above it and
    the lower half plain background. Scrolling up eases towards the newest book (the pile then sits below the eye
    line); scrolling back down returns to the base book.
  - **A taller pile** opens on the newest book; scrolling down all the way brings the base book to the eye line.
- Resizing or turning the screen works K out again and keeps the reader's book; the starting rule only applies
  when the screen opens.
- The screen is pinned to the viewport: the page behind it never scrolls or rubber-bands (iOS), and drags on the
  header don't move anything (drags on the bar move the book sheet).

## Book sizes from the covers

Books differ in page size like real books: tall picture books, square books and wide landscape books. Code:
`src/staircase/bookShapes.ts` (every constant and rule, pure and unit-tested); the loader reads the shapes
(`coverArt.ts`); `CanvasStack.tsx` draws them. Nothing changes in the data or sync.

- **Footprint** (spine length W and depth D) from the cover's shape, width ÷ height = D / W, clamped to 0.45–1.6:
  eff = REF × (shape / REF)^STRENGTH (REF = 124 / 190, STRENGTH 1), W = clamp(√(AREA / eff), 120, 240), D = eff × W,
  with AREA = 190 × 124. So a tall book (0.55) is about 207 × 114, a square one 153 × 153, a wide one (1.3) 135 × 175,
  and the standard shape is 190 × 124. A book without a known shape (no cover, a missing or failing one, or not read
  yet) is the standard 190 × 124.
- **Thickness**: 28 × (1 + VARIETY × (hv − 0.5) × 0.9), VARIETY 0.3, hv a stable hash of the book (its ISBN or
  no-ISBN key): 24.2 to 31.8, the same on every device, never from the cover. So a cover arriving late changes only
  its own book's footprint: the pile's height, the scroll mapping and every other book stay where they are.
- **Where the shape comes from**: the app's own photos and Open Library covers from the bitmap the loader already
  decodes for the colour; **Google Books** covers (no CORS headers) from the natural size of a plain `<img>` of the
  cover itself, never drawn to a canvas, so nothing is tainted. Read in idle time with the colours (the 60 books
  nearest the camera first), with their own retries and back-off; never on a frame.
- **The shape cache**: on this device only, in localStorage `library-card:cover-shapes` (beside the colour cache,
  keyed the same way: a photo by its bytes' SHA-256, a catalogue cover by its address), at most 2,000. Never synced,
  never in a backup, cleared by "Reset this device". The colour cache is unchanged; a cover whose shape isn't stored
  yet (a 1.12.0 entry) is simply read again later.
- **Arriving on screen**: a shape that arrives for a book being drawn eases its footprint from the standard one over
  `--duration-crossfade` (160 ms; at once with reduced motion), drawing only while it eases.
- **Everything else follows the per-book sizes**: the fan and the camera use the books' own cumulative thicknesses
  (the eye-line height between two books is interpolated between their middles); the gap, flags and month lines move
  with their books; the cover on the top face fits the face (cropped like `object-fit: cover`, now very little);
  the spine's title and avatar are fitted to the book's own spine, their size scaled with its thickness (28 = the
  usual size). Spine labels and page edges are cached per size bucket (6 px of spine length, 0.5 px of thickness)
  so the caches stay small. A new book's drop lands it on the books' own heights and its mass follows its thickness.
- **The setting**: Developer tools → Book stack → "Cover shapes" (on by default, this device only, localStorage
  `library-card:stack-shapes`). Off, the books have the seeded sizes they had in 1.12.0 (176–230 × 104–132 × 28, 34
  or 42) and K as before. The page's readout shows the constants (strength, variety, area and clamps); a benchmark
  result says whether shapes were on. Its pretend covers come in a few shapes. Without "Covers on the stack" no
  shapes are read, so every book is standard (thicknesses still vary).

## The gap around the eye-line book

The book at the eye line shows almost in full: the books above it lift away and the books below it drop a little,
so its top face (with its cover) and its spine are clear. Code: `src/staircase/eyeGap.ts` (pure, unit-tested); the
constants are in `src/staircase/stackModel.ts`.

- **The rule**: for a book at `t = index - s` (s: the camera's continuous position, the same one the fan uses), its
  lift is `GAP_UP * smoothstep(t, 0.3, 1.0) - GAP_DOWN * smoothstep(-t, 0.3, 1.0)`, with
  `smoothstep(x, a, b) = u²(3 - 2u)` for `u = clamp((x - a) / (b - a), 0, 1)`. Books one or more above the camera
  are fully lifted, books one or more below fully lowered, the eye-line book (t = 0, and up to 0.3 either way)
  doesn't move, and between whole books the gap slides with the camera.
- **The constants**, in book heights (one book height is the thinnest book, 28 px, the mock-up's book):
  `GAP_UP` 2.5 (70 px), `GAP_DOWN` 1.3 (36 px), ramp 0.3 to 1.0. The lift is added to each book's height in the fan
  (`stackProjection.fannedBook`), so the draw order is still by book index, bottom to top.
- **K** leaves room for the lifted books: `GAP_UP` (times the camera's tilt) comes off the height above the eye
  line before the books are counted, so a short pile opening on its base book still fits with its upper books
  lifted. A pile that only just fitted before may now open on its newest book. `eyeLineReach` (where the half
  sheet stops) is unchanged: the eye-line book itself doesn't move, the books below only drop away from it.
- **Markers** move with their books: a flag takes its own book's lift; a month line lies between two books, so it
  takes the average of their two lifts (in the middle of the gap when the gap is there).
- Lifted books far above the top or lowered below the bottom are skipped as before (the visible range is worked
  out from the books' projected positions); covers are asked for by book index, so their look-ahead is unchanged.
- The gap only moves with the camera: no idle animation, and reduced motion is unchanged.
- **The setting**: Developer tools → Book stack → "Gap around the eye-line book" (on by default) switches it off on
  this device (localStorage `library-card:stack-gap`, cleared by "Reset this device"); the pile is then as it was
  in 1.10.2. The page's readout shows the three constants, and a benchmark result says whether the gap was on.

## Markers

- **Month lines**: a thin dashed line under the first book of each calendar month, with a label at the right
  ("Nov 2026"). The oldest month gets one too (at the bottom of the pile). The year is larger in January and on
  the oldest month. Months without books have no line.
- **Book-number flags**, at the left, level with the book: **#1 ("First book!"), 10, 50, 100, then every 100**
  (200, 300, …). These are separate from the old staircase's milestones (10, 25, 50, 100, every 100), which are
  unchanged.
- Only markers next to books in the draw window are drawn, and their labels are drawn once and reused. A label
  that would cover the book in the middle of the view (the one being looked at) moves just above or below it,
  always inside the pile's area (never under the bar).

## Covers

The pile shows the family's real covers (`src/staircase/coverArt.ts` loads them, the rules are pure and
unit-tested in `src/staircase/coverColour.ts` (colours, sources, crop, retries, cache format) and
`src/staircase/coverPlan.ts` (draw range, look-ahead, colour queue, picture cache, fade), `CanvasStack.tsx` draws
them). Nothing changes in the data, sync or backups: the covers are the books' own `cover_url`s.

- **Spine colour**: a book with a cover takes its spine's colour from it. The cover is copied down to 16 × 16;
  near-white, near-black, grey and see-through pixels are skipped, the 30° hue bucket with the most pixels wins
  and its pixels' average is the colour (none if under 4% of the pixels are usable). Its saturation and lightness
  are clamped to the spines' bands, then it is darkened until the white title reaches 4.5:1 contrast. The covers'
  flat fill is the same colour a little lighter. A book with no cover, a cover that fails or one with no usable
  colour keeps its own colour (from its ISBN, as before). Page edges, shading and the reader's band are unchanged.
- **The cover on the top face**: every drawn book (the whole visible range, up to 14 each side of the camera)
  draws the cover's picture on its top face with one affine `drawImage`, cropped to the face's shape (never
  stretched), with the usual shade on top. Only faces too thin on screen (under 6 px, the page edges' "big
  enough" rule: far or edge-on) stay flat. It lies as on a real book, front up with its spine towards the reader:
  the cover's top at the spine's left end (where the spine's band and title start), its binding edge along the
  front. A turn, never a mirror.
- **Loading, ahead of the camera**: never in the draw loop. After a frame, the pile asks for covers in this order
  (`coverPlan.coverJobs`): the drawn books (picture and colour), nearest first; then pictures beyond them, 6 books
  ahead in the direction of travel and 2 behind while the camera moves (3 each way at rest); then colours. Covers
  are fetched and decoded two at a time (decoded off the main thread with `createImageBitmap`); drawing them small
  and reading their colour waits for an idle slice, at most 2 a slice and only while the slice has time left
  (Safari, which has no `requestIdleCallback`, gets a short slice just after a frame). Nothing is decoded or
  measured during a frame.
- **The colour queue**: when the pile opens, the colours of the 60 books nearest the camera are asked for first,
  nearest first, then the rest of the pile outwards from the camera, in idle time (while the camera moves, only
  the nearest 60; the rest follows once it stops). Colours already in the device's cache are turned into spine
  colours in idle time too (at most 40 a slice), so a book's colour is ready before it scrolls into view and its
  spine is drawn once, in its cover's colour.
- **The picture cache**: pictures are about 128 px on their longest side (about 43 KB each for a 2:3 cover, 64 KB
  at most), at most about 48 kept (about 2–3 MB). A picture is released only when the cache is over 48 **and** its
  book is more than 24 books from the camera (the furthest first); a drawn book's picture is never released.
- **Fading in**: a picture or colour arriving for a book already on screen cross-fades in over
  `--duration-crossfade` (160 ms): the book's own colour, then its cover's colour and picture over it together.
  The pile draws only while a fade runs (no idle loop). With reduced motion it switches at once. A cover arriving
  for a book off screen just shows when the book comes into view.
- **Sources and CORS**: the canvas is never tainted, since pixels only come from CORS responses or the app's own
  photos. Photos (`cover:<hash>`) come from the store's blob: URLs. Open Library covers (and archive.org, where
  they redirect) send CORS headers; they are fetched with an extra `lc-pixels=1` parameter so the service worker's
  opaque copy (cached for `<img>`) never answers. **Google Books thumbnails send no CORS headers**, so for them the
  Open Library cover for the same ISBN is used; with none, the book keeps its own colour and a flat top face.
- **Failures**: a 404 (or other final answer) isn't asked again this visit; a 403, 429, 5xx, offline or CORS
  refusal is tried again after 30 s, then 60 s, at most 3 times a visit.
- **The colour cache**: on this device only, in **localStorage** (`library-card:cover-colours`): one small entry
  per cover (a photo by its bytes' SHA-256, a catalogue cover by its address), at most 2,000 (the oldest go first),
  "no usable colour" included. Never synced, never in a backup, cleared by "Reset this device" with the app's other
  `library-card:` keys. Pictures are never stored: they are decoded again on the next visit (catalogue covers come
  from the service worker's cache).
- **The setting**: Developer tools → Book stack → "Covers on the stack" (on by default) switches all of this off
  on this device (localStorage `library-card:stack-covers`), for a device that struggles; the stack is then as it
  was in 1.10.0. The book stack page gives its pretend piles pretend covers while it's on, so the benchmark
  measures them; a benchmark result says whether covers were on, and the page's readout shows the cover pictures
  kept and their memory ("Cover pictures kept").

## Time zone

A book's month is the month of its `first_read_at` **in the household's time zone** (`households.time_zone`, the
same zone every "today" in the app uses; the device's zone if the household has none). Labels are written with
`Intl.DateTimeFormat` in the app's language (`strings.app.locale`). So a book read at 00:30 on 1 November in Taipei
is a November book even though it's still 31 October in UTC, and daylight saving time is followed.

## Live updates

The pile follows new reads as they happen (also from another tab or device, through sync):

- On the base book, the camera stays on the base book as the pile grows.
- If the reader is at the newest book, the new books **fall** onto the pile (below) and the camera follows them
  up as they land (with reduced motion, or more than 40 at once, they appear with the outline pulse instead).
- A pile growing taller than K doesn't move the camera (no jump).
- Anywhere else, the book in front of them stays in front of them; if it has gone (an undo), the nearest older
  book that's still there takes its place.

## New books since your last visit

Each time a reader opens the Family Staircase, the books added since **their** last visit on **this** device fall
onto the top of the pile, one after another, with weight. Code: `src/staircase/stackSeen.ts` (the rule and the
count), `src/staircase/dropMotion.ts` (every constant and the physics, pure and unit-tested), `dropSound.ts` (the
thud), `CanvasStack.tsx` (running and drawing it). Nothing changes in the data, sync or the fan model.

- **The count**: per reader, on this device only, in localStorage `library-card:stack-seen:<readerId>`: the number
  of stack books (the confirmed household first reads the pile shows) they had seen. Never synced, not in backups,
  cleared by "Reset this device" with the app's other `library-card:` keys (restoring a backup keeps it). It is
  written when the drop ends, when the reader leaves the screen and when the page is hidden (so an interrupted drop
  doesn't replay everything), always as the pile is then.
- **The rule**: New = the pile now minus the count. First visit for that reader on this device (no count): nothing
  falls, the count is recorded. New <= 0 (or the pile shrank): nothing falls. Up to 40: the newest New books (the
  pile's own order: first read, reader, ISBN) fall. More than 40: they show in place with the outline pulse. Pending
  reads don't count until confirmed; a backdated read arriving by sync may not be among the newest (accepted).
- **The drop** (the approved mock-up's defaults): weight 5, so gravity 700 + 300 × 5 = 2,200 units/s² (the 28-unit
  book is the unit); each book falls from 420 above its place (0.62 s, landing at about 1,360 units/s), turned in by
  up to 60° × height / 420, unwinding as it falls; the first is let go after 120 ms, then one every 260 ms. With
  more than 8, all but the last 8 go in a 50 ms burst first; the plan is squeezed so it all lands within about 4 s.
  A later book is never let go before the one under it, and never passes through it (tested at every step).
- **Landing**: impulse = min(1.4, speed / 1,400) × mass, mass = clamp(thickness / 28, 0.45, 2.5) × weight / 5. A book
  bounces at 0.15 × its impact speed if that is over 130 (once, off a settled surface), then stops. The landing kicks
  the pile's spring (k 300, damping 18) down by 14 × 17 × impulse: books above the landing book move with it, books
  below by exp(-depth / 3.5); it settles to exactly zero. The book squashes (thickness × (1 − 0.45 × sq), footprint
  × (1 + 0.1 × sq), sq = min(1, impulse) × 0.5, fading by exp(-12 t)); 5–10 specks of dust puff from its lower
  corners for 0.5–0.85 s. A falling book's flag and month line wait until it lands, then fade in.
- **Sound** (Web Audio, synthesised, no files): a sine from clamp(190 − 11 × weight − 14 × mass, 60, 200) Hz down to
  40 Hz over 0.2 s (6 ms attack, silent by 0.3 s), plus a 90 ms noise burst through a 500 Hz low-pass at 0.6 × its
  gain; gain = min(1, impulse) × 0.6. One per landing (not for the bounce). The audio context is created or resumed
  by a tap: the tap that opens the staircase counts; without one (a reload straight onto it) the thud is skipped
  silently. **Vibration**: 15–25 ms by impulse where the device has it (Android; iOS has none), once the page has
  been tapped (Chrome refuses it before). Both only while the page is visible.
- **The camera**: it starts where the pile without the new books would open, and as each book lands it goes where a
  pile of the landed books would open: on the base book while the pile fits (the books fall onto the top, above the
  eye line), on the highest landed book once it's tall (easing up with the pile), moving from the base to the newest
  (eased, no jump) if the pile grows past K during the drop. The gap (above) applies to falling books like any other.
  Scrolling takes the camera over; the drop carries on. Nothing blocks Back or the bar.
- **Live updates**: books arriving while the reader is at the newest book fall the same way (added to a drop under
  way); anywhere else they simply appear (as before).
- **No idle loop**: the drop's frames run only while a book waits or falls, or the spring, a squash or dust moves;
  covers keep loading as usual.
- **Settings**: "Stack sounds", on by default, per device (localStorage `library-card:stack-sounds`): Grown-ups →
  Settings → Sounds, and the 🔊/🔇 button (56 px) at the end of the header row, beside Back and the title (it fits
  there on a 360 px wide phone). Muted, the books still fall, silently, without vibrating.
- **Reduced motion**: nothing falls, no spring, dust or sound; the new books appear with one calm outline pulse
  (600 ms) and the count is recorded.
- **Developer tools → Book stack**: "Replay new-book drop" (1–50) replays the newest books falling on that page's
  pile (now with 7- and 40-book piles too); "Pretend I've been away" sets the open card's reader's count back by
  that many, so their next visit to the Family Staircase drops them.

## Accessibility

- Screen readers get a hidden list of every book, newest first: "Step N, title, read by reader, date".
- Arrow Up and Down step one book (with the same ease); the pile shows a focus ring when focused from the keyboard.
- With reduced motion, the camera moves without easing, and new books appear with an outline pulse instead of
  falling (no spring, dust or sound).
- A polite live region says "3 new books added since your last visit" when the screen opens with new books.
- The bar under the pile is a button that opens the book sheet (below); the sheet's panel is a dialog while open.

## The book sheet

The bar under the pile (the eye-line book's avatar and title, with a small drag handle on top) opens into a sheet
about that book. Code: `src/screens/journeys/BookDetailsSheet.tsx` and `bookDetailsSheet.css`; the rules are pure
and unit-tested in `src/staircase/sheetState.ts` (states), `src/staircase/bookFamily.ts` (the family part),
`src/books/details.ts` (the web details) and `src/books/detailsCache.ts` (the cache).

### States

- **Collapsed**: the bar, as before. **Half**: over the lower part of the screen, stopping just below the book at
  the eye line (`stackProjection.eyeLineReach`: half the thickest book's spine plus how far a turned cover reaches,
  plus `--space-3`), so that book stays in view; on screens too short for that it still shows
  `--stack-sheet-min-half` over the bar. **Full**: the whole area under the header.
- A tap on the bar opens collapsed to half, and closes half or full. Dragging the bar moves the sheet with the
  finger; on release it goes to the nearest state, or after a flick (0.4 px/ms or faster) on to the next state in
  that direction. Escape and the browser's Back close it: opening pushes a history entry (same URL), closing
  another way takes it off again.
- The sheet **lies over the pile**: the pile keeps its size (the page's dock keeps the bar's place), so K and the
  camera never change when it opens. While **half** open the pile above still scrolls and the sheet follows the
  book at the eye line, its content fading in (no fade with reduced motion). While **full** the pile isn't drawn at
  all (`CanvasStack`'s `paused`); it catches up when the sheet closes.
- Accessibility: the bar is a real button with `aria-expanded`; the open panel is a (non-modal) dialog named
  "About <title>", which takes the focus, and the focus goes back to the bar when it closes. Arrow keys on the pile
  work as before while it's collapsed. Buttons are kid-sized (56 px). Reduced motion: no easing, fade or pulse.

### What it shows

1. The cover (bigger), title, subtitle (when the web has one the title doesn't already include) and authors.
2. **The family's part**, from data the app already keeps (no new tables, no DataStore or sync changes):
   - "First read by <avatar + name> on <date>": the **pile book's own reader** (the stack item the sheet is open
     on) and their first confirmed read of it, the same pile book as "Book #N". When two readers have read the
     same title, each one's pile book names them, not whoever read the title first. The date is in the
     household's time zone.
   - "Book #N on the Family Staircase": the stack item's own step.
   - "Read N times", with every reader's avatar and count (earliest reader first): the read summaries, which only
     count confirmed reads.
   - A home book ("A home book, on your shelf"), and any loan out now (not returned): the library's name, who
     borrowed it and its due chip. Returned loans don't show.
   - Its collection and number, when it's in one.
   - "After a book" notes are **not** shown: a note is for a reader's next new book, not linked to any book, so
     there is no note for a given book to show.
3. **About this book** (the web details), only for books with an ISBN (`noisbn-` books show the family part only):
   the description (plain paragraphs, about six lines with "Read more"), publisher, year, pages, language,
   an age rating only when Google Books marks the book as mature ("Google Books rating: For grown-ups"; nothing
   for Google's default NOT_MATURE or a missing label), and "More on Google Books" or
   "More on Open Library" (the provider that found the book; new tab, `rel="noopener noreferrer"`). Only fields
   that exist show; with nothing found: "No more details found for this book."

### The web lookup

- By ISBN, from the same providers in the same order as adding a book (`src/books/lookup.ts`, whose URL builders
  and `fetchJson` are shared): Taiwanese prefixes (978957, 978986, 978626) Google Books first, everything else Open
  Library first; the second provider only fills the gaps. Open Library's Books API (`jscmd=details`) is used, and
  the edition's work for a description when the edition has none. `VITE_GOOGLE_BOOKS_API_KEY` is used when set.
- Provider answers are untrusted: only fields of the expected type are kept, HTML is stripped to plain text
  (rendered as text, never as HTML), and links are kept only when they're https on the provider's own site.
- **Only when the sheet is open on the book**: the first book straight away, then each book the half-open sheet
  stays on for 350 ms (not every book scrolling past). Nothing is fetched while it's closed.
- **Never blocking**: the family part shows at once; "About this book" shows a small placeholder while it looks.
  The providers get 8 s between them. Offline, after a failure or at the timeout, it shows the "No more details"
  message with **Try again**; back online it asks again by itself.

### The cache

- In **localStorage** on this device, one key per book: `library-card:book-details:<isbn>`. Chosen as the lightest
  store that fits: answers are small (descriptions are cut at 6,000 characters) and capped at 300 books (the
  oldest go first, and half go if the browser is full), and the app's `library-card:` keys are already **cleared
  by "Reset this device"**. It needs no IndexedDB version bump, and it is never synced, never in a backup and not
  in the records or outbox stores.
- A cached answer (details, or "not found") shows at once; when it's older than **30 days** it still shows and is
  asked again quietly (a failed refresh keeps the old answer). **Failures are never cached**, and neither is an
  answer cut short by the timeout.
