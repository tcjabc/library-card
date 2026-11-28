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
    standing on the ground, which fills most of the lower half (see "Sky and ground"). Scrolling up eases towards the newest book (the pile then sits below the eye
    line); scrolling back down returns to the base book.
  - **A taller pile** opens on the newest book; scrolling down all the way brings the base book to the eye line.
- Resizing or turning the screen works K out again and keeps the reader's book; the starting rule only applies
  when the screen opens.
- The screen is pinned to the viewport: the page behind it never scrolls or rubber-bands (iOS), and drags on the
  header don't move anything (drags on the bar move the book sheet).

## Sky and ground

The pile stands on a meadow under a sky whose colour changes with height. Code: `src/staircase/scenery.ts` (every
constant and rule, pure and unit-tested); `CanvasStack.tsx` draws it on the pile's own canvas before the books.
Nothing changes in the data or sync.

- **One canvas, still opaque**: each frame starts with the scenery instead of the page's plain background. Nothing
  is written to the page while scrolling, and the canvas is never read (pixelGuard, below).
- **The sky** is one vertical gradient. Its colour goes by **altitude above the horizon**, absolute and
  logarithmic: t = log(1 + alt) / log(1 + 1,000), alt in books of 28 px, so a pile's sky never changes colour as
  it grows. Four colours: `--stack-sky-low` at the horizon (t 0), `--stack-sky-high` at 10 books (t 0.35),
  `--stack-sky-upper` at 100 (t 0.67) and `--stack-sky-space` at 1,000 and above (t 1). The gradient runs from the
  altitude at the top of the view to the horizon (or the bottom of the view when the horizon is below it), sampled
  at 5 points down the screen (altitude is linear down the screen, t isn't). The gradients are kept by t in steps
  of 1/256 (at most 64), so a new one is made only when the view has climbed a step.
  - A pile of 1 on its base book shows the low sky up to about t 0.33 at the top; a pile of 11 at its newest
    reaches about 20 books (t 0.44), its ground still low on the screen; a pile of 100 at its newest is an
    almost even upper sky; 1,000 is the edge of space.
- **The ground** is anchored to the world: its contact line is the base book's bottom, so it moves 1:1 with the
  base book, its gap lift included (`GAP_DOWN` lowers it with the base book once the camera is above it). It
  doesn't follow the drop's spring: a landing on a short pile may press the base book into the soft ground for a
  moment. As the camera climbs it scrolls away: on a phone the contact line leaves the view about 11 books up and
  the horizon about 16. With nothing of it on screen, no ground work is done at all.
  - **Horizon**: `GROUND_DEPTH` (300 px) of meadow behind the pile, seen at 24°, so sin 24° × 300 (about 122 px)
    above the contact line. A haze (`--stack-horizon`, fading in over `HORIZON_HAZE`, 28 px) above a thin line in
    the same colour. A view shorter than `GROUND_FULL_HEIGHT` (480 px; a phone on its side is about 290) gets less of both, in
    proportion to its height but never under `GROUND_SCALE_MIN` (0.6) of them (`groundSize`), so its base book
    still has a band of sky above the horizon; portrait phones and tablets get all of it.
  - **Meadow**: one fill from the horizon down, `--stack-ground-far` at the horizon to `--stack-ground` at the
    contact line and below (hazier far off).
  - **Shadow** (`--stack-ground-shadow`): the base book's own footprint at height 0, so it follows its cover's
    shape and its turn (−s × 10°, and a falling first book's spin), grown a little (`SHADOW_SPREAD`: mostly front
    to back) and moved towards the reader (`SHADOW_FORWARD`), in two layers, so it shows as a soft band in front of
    the spine. Not drawn while the base book waits to fall; while a first book falls onto the ground its shadow
    grows as it comes down (`shadowStrength`: none from 420 px up, full on the ground).
- **Dark theme**: a dusk sky and an evening meadow (the same tokens' dark values; no stars). When the colour
  scheme changes while the pile is open, the tokens are read again and the next frame uses them (labels, markers
  and scenery redrawn).
- **Month lines** over the scenery take whichever of `--stack-line-on-light` and `--stack-line-on-dark` contrasts
  more with the sky or ground behind them (at least 3:1 against every sky colour, the horizon and the meadow, in
  both themes, checked by a unit test). With the sky and the ground off they keep `--color-text-muted`. Flags and
  month labels are on their own chips (unchanged).
- **Desktop**: the scenery fills the pile's column (the canvas), not the whole window.
- **No idle loop**: the sky and ground change only when the camera or a drop draws a frame. Reduced motion
  changes nothing here (nothing moves by itself).
- **The settings**: Developer tools → Book stack → "Sky" and "Ground & horizon" (both on by default, this device
  only: localStorage `library-card:stack-sky` and `library-card:stack-ground`, never synced, not in backups, cleared
  by "Reset this device"). Off, the pile is on the plain background as in 1.14.0. The page's readout shows the
  sky's t at the top and bottom of the view and whether ground is in view; its pretend piles include 1 and 11
  books; a benchmark result says whether the sky and the ground were on.

## Clouds and decor level

Clouds in the sky around the pile (`src/staircase/clouds.ts`, pure and unit-tested; drawn by `CanvasStack.tsx`), in
three layers (`LAYERS`). Only with the sky on.

- **Backdrop** (`backdrop`): soft clouds far behind the pile, drawn after the sky and before the ground, so the
  meadow hides any cloud behind the horizon (no clipping needed). Each moves its own factor in `PARALLAX`
  (0.25–0.35) of the pile's scroll: on screen it's drawn that fraction of the way from the eye line to where the
  world puts its altitude (`cloudBaseY`), so it sits at the eye line when the camera's altitude is its own. Nearer
  ones (bigger factors) tend to be bigger and a little stronger. Altitude cells of `CLOUD_CELL_BOOKS` (18) books,
  0–2 clouds each. At most five a frame (Full), three with Reduced, which keeps only the "core" half.
- **Foreground** (`foreground`): a few small, thin, faint wisps (alpha 0.35–0.5, 90–150 px wide, three flat wisp
  shapes, `WISP_SHAPES`) nearer than the pile, moving faster than it: each its own factor in
  `FOREGROUND_PARALLAX` (1.2–1.4×) of the scroll. Drawn after the backdrop and the ground (so one can drift over
  the meadow like low mist) and still before the books, so a book always covers them: never over a cover or a
  spine. Cells of 12 books, 0–2 wisps each (about one a phone view on average). At most three a frame, and only
  with Full decor. Never with reduced motion.
- **Still** (`still`): with reduced motion, instead of both layers: clouds that move 1:1 with the world (no
  parallax) from their own denser cells (10 books, 0–2 clouds, mostly one), so a phone view shows one to three
  (about 2.6 on average; in 1.16.0 the backdrop's cells moving 1:1 left about 0.6, with none in half the views).
  Never more than the Reduced cap (three). The eye-line fade is a step there, not a ramp.
- **Sprites**: nine flat-bottomed puff shapes (`CLOUD_SHAPES`: six for the backdrop and the still layer, three
  wisps), drawn once into one atlas canvas at the current scale in `--stack-cloud`, over a slightly lower copy in
  `--stack-cloud-shade` (a shaded rim underneath). Made the first time a cloud is drawn and again after a
  resolution step or a colour-scheme change, like the labels. Nothing is ever read back (pixelGuard). The wisps use
  the same tokens, at low alpha.
- **Seeding**: every layer's cells come from a hash of the household id, the layer name and the cell, so clouds
  never move as the pile grows, between visits or between devices. None below `CLOUD_MIN_ALT` (3 books); above sky
  t `CLOUD_THIN_FROM` (0.8, about 250 books) they thin out, to none at t 1 (1,000 books, space).
- **Scroll-driven only**: clouds change only when the camera or a drop draws a frame (no idle loop, no timers).
  With decor None, the clouds off, or no cloud cell in view, no cloud work is done in the frame.
- **How many**: when a layer has more clouds in view than it may draw, those nearest the middle of the view are
  drawn, so any that wait for room do it at the edges.
- **The eye line**: a cloud of any layer crossing the eye-line band (the eye line ± `eyeLineReach` of the biggest
  book, as the book sheet's half state uses) fades to `EYE_ALPHA` (0.2), easing back over `EYE_FADE_PX` (32 px)
  either side, a cheap check per cloud per frame. The spine title, the book sheet's edge and the markers there stay
  calm.
- **Dark theme**: dusk-tinted clouds (the tokens' dark values).
- **Month lines over clouds**: a line crossing a cloud (any layer) takes the ink whose worst contrast with the sky
  and the cloud (lit and shade, at the cloud's strength) is better (`lineStyle`). If even that is under 3:1 (in the
  light theme, a white cloud high up in the deep blue sky, where neither ink suits both), the line gets a casing in
  the other ink under its dashes. Checked for every sky colour in both themes by a unit test. Flags and month labels
  keep their own chips, so a cloud never touches their text's contrast.

### Decor level and the drop-out rule

- **The levels** (`Decor` in `drawBudget.ts`; which layers: `cloudLayers`):
  - **Full**: the backdrop (up to five) and the foreground wisps (up to three).
  - **Reduced**: about half the backdrop (its core clouds, up to three), no wisps.
  - **None**: no clouds; the sky and ground stay.
- **The setting**: Grown-ups → Settings → "Sky decoration", next to Sounds: Full / Reduced / None as three big
  choices (`SkyDecorSection.tsx`, the shared `ChoiceButton` with its pressed state). The device's level is
  localStorage `library-card:stack-decor` (Full unless chosen; never synced, not in backups, cleared by "Reset this
  device"). The developer tools' decor chips are the same setting; both follow it live, and so does an open pile.
- **The drop-out rule** (`nextBudget({ decor, scale }, averageFrameMs, frames)`): after each second of motion,
  slow frames (over 22 ms on average, at least 30 frames) lower the decor one level first, Full → Reduced → None
  (so the wisps go first, then the backdrop), then cut the page lines back to the books near the eye line (see
  "Page edges"), and only then does the resolution step down as before (2 → 1.5 → 1.25 → 1). A device drawing
  under 30 frames a second keeps counting past the second until it has 30 (`budgetDue`); up to 1.17.0 it reset
  every second and so never got a verdict at all. Never back up. Like the resolution cap it's per visit, never saved. With the clouds or the
  sky off there's no decor to lose, so the resolution steps down at once.
- **Shared with the journey scenes** (since 1.21.0): the journey screen's scene uses the same rule for its motion
  (`budgetDue`, `nextBudget`, `SLOW_FRAME_MS`, `budgetFrameMs` from `drawBudget.ts`, through
  `src/journeys/sceneBudget.ts`): Full → Reduced → None per visit, never back up (docs/journeys.md, "Slow
  devices"). A change to the rule here changes both; the stack's behaviour and tests are unchanged by it.
- **Decor in effect**: the least of the setting, this visit's cap and, with reduced motion, Reduced
  (`decorInEffect`, which also says why).
- **Reduced motion**: no differential parallax (no foreground wisps; the still layer moves 1:1 with the world),
  decor at most Reduced, and no fades (the eye-line fade is a step).
- **Benchmark**: `StackOverrides.decor` fixes the decor while it runs (the device's level); results say whether the
  clouds and the foreground were on, and the decor level.

### Developer tools

Developer tools → Book stack: "Clouds" (on unless switched off, `library-card:stack-clouds`), "Foreground clouds"
(on unless switched off, `library-card:stack-clouds-fg`), the decor level (Full / Reduced / None, the same setting as
Grown-ups → Settings → Sky decoration) and "Pretend slow frames" (off unless switched on, `library-card:stack-slow`:
every moving frame counts as at least `PRETEND_SLOW_FRAME_MS`, 40 ms, for the budget only, so the drop-out can be
seen on a fast device). All apply on the Family Staircase on this device too. The readout shows the decor drawn and
why (the setting, this visit's cap, reduced motion), and the clouds behind the pile and the foreground wisps drawn
at the latest frame.

## Page edges

The paper sides of each book (`drawFace` in `CanvasStack.tsx`, rules in `drawBudget.ts`).

- **Two looks**: the page lines (a cached stripe sprite per thickness, 2 px wide, a strip of paper then a thin
  line repeated down the edge, stretched across the face in one `drawImage`), or a flat paper fill with an outline
  (a fill and a stroke).
- **Range** (since 1.17.1): every book the renderer draws has its lines (`PAGE_RANGE.all` = `FAN_CAP`, 14 books
  either side of the camera), so a book already has them when it scrolls into view. Up to 1.17.0 only the books
  within 4 of the camera had them (`LOD_DISTANCE`), and they switched on and off as books crossed that line, a
  visible pop. Measured at 1,000 books on the phone profile (6× CPU throttle, headless) the wider range costs
  nothing measurable in JavaScript (5.84 ms a frame either way) and saves about 33 canvas calls a frame, since a
  striped face is one call and a flat one two.
- **No pops** (`pageLineAlpha`): the lines fade out over `PAGE_FADE_BOOKS` (2.5) books past the range, and fade in
  from `LOD_MIN_PX` (6 px) over `PAGE_THIN_FADE_PX` (3 px) of face thickness as a book turns its side towards you
  (thinner faces are flat). In between, the stripes are drawn over the flat face at that strength.
- **Slow frames**: after the decor, the drop-out rule cuts the page lines back to the books within `LOD_DISTANCE` of
  the camera (`PageLines` 'near'), once per visit and never back up, before the resolution steps down. The range
  then shrinks over about half a second (`easePageRange`, `PAGE_RANGE_EASE` books a second; at once with reduced
  motion), and the fade past it means no book loses its lines at once.
- **Dev readout**: "Page lines" shows the level and the range drawn at the latest frame.

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
  cover itself (the same `<img>` its top-face picture is drawn from, see Covers). Read in idle time with the colours (the 60 books
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
- **Where the picture comes from** (`coverColour.coverSource`, in this order): the app's own **photo**
  (`cover:<hash>`, from the store's blob: URL); a cover read through **CORS**: Open Library (and archive.org, where
  it redirects), also for a Google Books cover by the book's ISBN, fetched with an extra `lc-pixels=1` parameter so
  the service worker's opaque copy (cached for `<img>`) never answers; else the **Google Books thumbnail itself as
  a plain `<img>`** (1.13.1); else none. Google's thumbnails send no CORS headers, so a Google cover tries Open
  Library's cover for its ISBN first (it gives the spine its colour); once that is missing (404), fails (403, 429,
  offline…) or there's no ISBN to ask by, its picture comes from the Google `<img>` (no `crossOrigin`), with the
  same size, idle-time, picture-cache, fade and back-off rules as any other cover, cropped and drawn on the top face
  the same way. Its spine keeps the book's own colour (its pixels can't be read); Open Library is still asked again
  for the colour when its wait is over. Before 1.13.1 such books (a Google-only cover with no Open Library cover,
  for example a Taiwanese edition, which looks Google Books up first) kept a flat top face and their own spine colour.
- **Never reading a tainted canvas**: drawing a picture loaded without CORS works, but taints the canvas it is drawn
  on, and reading pixels from a tainted canvas throws. `src/staircase/pixelGuard.ts` is the only staircase code
  allowed to read pixels (an ESLint rule bans `getImageData`, `toDataURL`, `toBlob` and `convertToBlob` in
  `src/staircase` everywhere else, and a unit test scans the sources too). A Google cover's small copy is marked
  tainted, a marked canvas drawn onto another marks that one too, the pile's canvas is marked when it draws one,
  and `readPixels` refuses a marked canvas. The colour sampler reads only its own 16 × 16 canvas, drawn from
  CORS-safe covers. The pile's canvas is never read in the app; the developer tools' "Measure raster" probe goes
  through the guard and is skipped once a Google cover has been drawn on it. Checked in headless Chrome (desktop
  Chrome 157, with and without the service worker); on Safari and iOS drawing a cross-origin `<img>` to a canvas is
  standard, but it hasn't been checked on a device yet.
- **Failures**: a 404 (or other final answer) isn't asked again this visit; a 403, 429, 5xx, offline or CORS
  refusal is tried again after 30 s, then 60 s, at most 3 times a visit per source (Open Library, the Google
  `<img>`), also while the camera rests (1.13.0 waited until the camera moved). A cover first loaded for its colour
  only, whose book comes into view meanwhile, gets its picture when the load ends, without another ask.
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
- **Cover diagnostics** (Developer tools → Book stack, 1.13.1): the Family Staircase's pile as it was when it was
  last open on this device, newest first: for each book its title and key, where its cover comes from (photo /
  Open Library / Google img, with why Open Library didn't give it / none), its state (not requested, loading,
  ready, failed with the reason and tries, backoff until when), whether this device has its colour and shape
  cached, and its top face: the cover, or why it is flat (no cover, covers off, failed, backoff, outside draw
  range, top face not showing, LOD, loading, not requested). "Copy" copies it as text with the version line, to
  paste from a phone. Local only (`src/staircase/coverDiagnostics.ts`): in memory and in this tab's
  sessionStorage (`library-card:cover-report`, gone when the app closes), never synced or sent.

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
