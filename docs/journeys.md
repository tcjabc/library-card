# Reading Journeys

A reader picks a journey in the gallery (`#/journeys`); every book they read for the first time after starting
climbs one step (re-reads don't count). The journey screen (`#/journey`) shows the steps as a vertical track: the
finish at the top for rising journeys, at the bottom for Ocean Deep (it goes down). Config: `src/journeys/journeys.ts`
(steps, direction, stage labels in `src/strings/en.ts`, a theme colour `--journey-*` each). Progress:
`src/journeys/progress.ts`. Completion: `src/journeys/completion.ts`.

## Completion

`checkJourneyCompletion` finishes the active journey once every step is filled. It runs after every read, and while
the hub, the gallery or the journey screen is open (`useCompletionCheck` → `watchJourneyCompletion`): when the
screen opens and again after every change to reads or journeys, from this tab, another tab or another device (a
grown-up confirming a read elsewhere, a sync). So the journey screen never sits at "0 more books to go!": the
completion sends the reader to the gallery with the celebration. Checks never overlap.

## Scenes (since 1.18.0)

Journeys with a scene show flat art behind the track instead of the plain tinted track. Since 1.20.0 all eight
have one (a unit test checks every journey id). The plain track with the journey's emoji and colour is still in the
code (`JourneyScreen.tsx`, for a journey without a scene config) but is now unused; it is kept for the next journey.
The gallery, the hub tile and the celebration are unchanged.

| Journey | Since | Steps | Travel (px) | Factors far / mid / near | Loops | Far | Mid | Near |
|---|---|---|---|---|---|---|---|---|
| Ocean Deep (down) | 1.18.0 | 5 | 200 | 0.2 / 0.5 / 1 | 13 | water bands, wave line, rays, faint fish | bubbles, two fish, a jellyfish | sea floor, seaweed, treasure chest, a big fish passing |
| Redwood Tree | 1.19.0 | 8 | 300 | 0.2 / 0.6 / 1 | 8 | forest-morning sky, misty hills, tiny birds | the trunk with bark and branches, a bird, falling leaves, the canopy at the top | needle clusters at both edges, ferns, the forest floor |
| Ocean Cliff | 1.19.0 | 10 | 360 | 0.2 / 0.6 / 1 | 9 | warm sky, faint clouds, the sea and a sailboat | the rock face with ledges and grass, two gulls, the lighthouse at the top (its lamp glimmers) | waves and foam, a rock outcrop, rising spray, a cloud passing |
| Skyscraper | 1.19.0 | 12 | 420 | 0.2 / 0.6 / 1 | 7 | city dawn, a distant skyline, a plane trail | the glass tower with windows (some lit, three twinkling), the antenna's blinking light at the top, a helicopter | neighbouring buildings, a crane arm, the street and a tiny car, a cloud passing |
| Rapunzel's Tower | 1.20.0 | 15 | 480 | 0.2 / 0.6 / 1 | 10 | storybook dawn (peach, lilac, light blue), rolling hills, a distant castle, tiny birds | the stone tower with brick courses and ivy, two arched windows glimmering, the slate roof with a swaying flag and the braid window at the top, a bird | leafy branches from both edges (sway), falling petals, a cloud passing, the meadow with flowers |
| Hot-Air Balloon | 1.18.0 | 20 | 640 | 0.2 / 0.6 / 1 | 7 | sky bands, faint clouds, a distant balloon | the finish balloon at the top, two clouds | two big clouds, the hills and a tree |
| Ladder to the Moon | 1.20.0 | 25 | 640 | 0.2 / 0.6 / 1 | 11 | night bands (twilight in light), small stars with four twinkling, the moon at the top, a faint planet | the long wooden ladder, two shooting stars, an owl gliding | two night clouds, two big stars glimmering, rooftops on a hill with lit windows |
| Rocket Through Space | 1.20.0 | 30 | 640 | 0.2 / 0.6 / 1 | 11 | pale blue into navy and violet, stars with three twinkling, a faint nebula, a ringed planet at the top | the rocket at the top (bobbing, flame flickering), two satellites, a star cluster | two streaks, two asteroids drifting, the planet's curve and horizon glow |

Travel grows with the steps, about 30–40 px a step (a unit test keeps it there, and within `MAX_TRAVEL`), so a
short journey still shows its finish-end art (the canopy, the lighthouse, the antenna) near the finish. Journeys
longer than `MAX_TRAVEL` / 28 steps (Ladder to the Moon's 25, Rocket Through Space's 30) take the whole 640 px
(about 26 and 21 px a step): the cap wins, and the test expects exactly `MAX_TRAVEL` for them.

- **Where**: `src/journeys/scene.ts` (pure, unit-tested: which journeys have a scene, the layers, the shift, the
  settle, the motion rules, each layer's transform), `src/journeys/journeySeen.ts` (the seen step),
  `src/screens/journeys/JourneyScene.tsx` (the layers and their motion), `src/screens/journeys/sceneScroll.ts`
  (moving the layers with the scroll; the browser is passed in, so it's unit-tested), `src/screens/journeys/scenes/*.tsx` (each scene's art, one lazy chunk each, about
  1.1–1.7 KB gzipped; `parts.tsx` holds the shared cloud, which takes a token pair, and the star sparkle), `src/screens/journeys/journeyScene.css`. The journey screen itself is a lazy chunk too.
- **Layers**: far (slowest), mid and near (fastest), each an inline SVG group in a fixed backdrop behind the page
  (`position: fixed`, the large viewport's height, so no gap when a phone's browser bar slides away; `100vh` first
  for browsers without `lvh`, kept in the production CSS by its target, see CLAUDE.md "Build"). The track's
  rows (stage label, numbered dot, cover, the reader's avatar) are real DOM rows over it and never move with it.
  Each layer is taller than the view by its travel (`layerTravel`: its factor × the scene's travel, both clamped:
  `MAX_FACTOR` 1.5, `MAX_TRAVEL` 640 px) and sits the shift × its travel up. Near art (hills, sea floor)
  extends past the screen's edges so a shift never shows a gap. Each layer has `will-change: transform` in every
  decor level: its own compositor layer, so moving it never re-rasters its art (without it, Reduced and None
  re-rastered about 2,500 tiles per scroll of the 30-step Rocket, since with no loops nothing else promoted the
  layers).
- **The shift** (0–1): how far down the page the reader has scrolled (`scrollShift`: 0 at the
  top end of the track, 1 at the bottom end). Rising journeys start at the bottom, so as the reader climbs the
  world moves down; Ocean Deep starts at the top, so as they dive it moves up. A page that can barely scroll
  (Ocean Deep's five steps on a tall screen) uses the reader's step instead (`stepShift`): under a quarter of a
  view of scroll range it's the step's place, from three quarters it's the scroll, a smooth mix in between
  (`SCROLL_BLEND`), so a phone's browser bar sliding away never makes the scene jump.
- **Applying the shift** (since 1.20.1, `sceneScroll.ts`): each layer's own inline transform
  (`layerTransform`: a translate3d, rounded to 0.1 px, written only when it changes). Nothing is set on the
  scene's root: before 1.20.1 the shift was a custom property (`--journey-shift`) on the root, which every element
  of the scene inherits, so each scroll frame restyled the whole scene (87 of the Rocket's 91 elements, 125 of the
  Ladder's 135) instead of the three layers. One passive scroll listener reads `scrollTop` in the scroll event;
  the page's scroll range and the view's height are kept from the last resize (the window's `resize`, and a
  ResizeObserver on the track for content changes), so the animation-frame callback only writes. Reading the
  scroll inside that callback forced a style recalculation every frame (the ambient loops had just changed
  style). At most one frame per change; no other script runs while scrolling.
- **The settle**: when the reader's step has changed since they last saw the screen, each layer starts where the
  old step put it (`settleOffsets`; the near layer at least `MIN_SETTLE_PX`, 60 px, and at most its travel, far
  and mid scaled by their factors, so even one step of a long journey shows) and glides to where the new one does
  over `SETTLE_MS` (1.2 s), a transform on
  the layer's inner box with `will-change` only while it runs. First visit: no settle. It never replays: the seen
  step is recorded on every visit, whatever the motion setting. While the screen is open, a step change (a read
  arriving) settles too.
- **The seen step** (`journeySeen.ts`): localStorage `library-card:journey-seen:<readerId>:<journeyRecordId>`, the
  step the reader last saw for that journey (a new journey starts fresh). Device-local: not synced, not in backups,
  cleared by "Reset this device" with the app's other `library-card:` keys. Decided while rendering by reading only,
  written in an effect (the Family Staircase's `stackSeen.ts` pattern).
- **Motion** (`sceneMotion`), from Grown-ups → Settings → Sky decoration (`library-card:stack-decor`, shared with
  the Family Staircase's clouds): Full = gentle ambient loops (bob, drift, rise, sway, glimmer, fall, blink, flicker: CSS animations only,
  at most `MAX_LOOPS` 15 per scene) and parallax; Reduced = parallax and the settle, no loops; None = a still
  picture at the reader's step. The system's reduced motion is always still: no loops, no parallax, no settle (and
  the avatar stops bouncing, as before).
- **Slow devices** (since 1.21.0, `src/journeys/sceneBudget.ts`, `src/screens/journeys/sceneFrames.ts`): the
  Family Staircase's per-visit drop-out rule, shared from `drawBudget.ts` (`budgetDue`, `nextBudget`,
  `SLOW_FRAME_MS`; see docs/staircase.md, "Decor level and the drop-out rule"). After about a second of measured
  frames (at least 1 s over at least 30 frames, so a device under 30 frames a second still gets a verdict),
  frames averaging over 22 ms lower the scene a level for the rest of the visit: Full → Reduced (the ambient
  loops stop: the `journey-scene--loops` class goes, nothing re-mounts) → None (the parallax stops and each layer
  is frozen exactly where it is: no move, and nothing moves it again this visit, not a resize or a step change;
  `layerDriver` in `sceneScroll.ts`). A scene that opens still (Sky decoration None, reduced motion) has no
  earlier position, so its layers go to the reader's step's place (`placeLayers`), as before. Never back up within the visit, and
  the Sky decoration setting is never changed: the next visit starts from it again. The level drawn is the least
  of the setting, this visit's cap and, with reduced motion, None (`sceneLevel`, which also says why), on the
  scene's root as `data-motion`. Frames are measured with requestAnimationFrame only while there's something to
  measure: while the page scrolls (and `SCROLL_SAMPLE_MS`, 250 ms, after the last scroll event), during the
  settle, and for `OPEN_SAMPLE_MS` (3 s) after the screen opens with loops running; then the loop stops. An idle,
  healthy screen has no loop and no timer, and at None nothing is measured. A gap over `FRAME_BREAK_MS` (500 ms) is
  a pause (a hidden tab), not a slow frame.
- **Developer tools** → Journey scenes on slow devices: "Pretend slow frames on journey screens" (this device only,
  off unless switched on, `library-card:journey-slow`, separate from the book stack's switch: every measured frame
  counts as at least 40 ms, so about a second of scrolling lowers the motion a level) and what the last journey
  screen did this session (its level and why, the setting, this visit's cap, and when it was lowered; kept in
  memory, never stored).
- **Colours**: tokens only, `--journey-scene-*` in `src/theme.css` with light and dark (dusk) values; the art never
  holds a colour (`paint('…')` / `ink('…')` in `scenes/art.ts`). Text and dots over a scene sit on a backing
  (`--journey-scene-backing`: the nav row, the title block, stage labels, the start and finish rows, a ring round
  each dot), and the track's path is `--journey-scene-path`. Every scene journey's `--journey-*` colour has a dark
  value too (still 4.5:1 with white text). A unit test checks every token a scene uses has both values.
- **Accessibility**: the art is decorative (`aria-hidden`); the track keeps its labels. In phone landscape the scene
  fills the width behind the track, which stays a scrolling column.

### Adding the next scene

1. Add the journey to `SCENES` in `src/journeys/scene.ts`: its travel (px, ≤ 640: longer journeys usually want more)
   and the three factors (far < mid < near; 0.2 / 0.5–0.6 / 1 so far).
2. Write `src/screens/journeys/scenes/<Name>Scene.tsx`: a default-exported component taking `{ layer }` and
   returning that layer's SVG, every colour through `paint` / `ink`, positions through `at` (top/bottom % of the
   layer's height; things at the track's top end near the top of their layer, at the bottom end near its bottom).
   Mark looping pieces `scene-loop scene-loop--<kind>` (bob, bob-slow, drift, drift-back, drift-slow, rise,
   rise-slow, sway, sway-back, glimmer, glimmer-slow, blink, fall, fall-slow, pass, flicker), at most 15. Put
   the class on a whole `<svg>` (or a wrapping box), not on a shape inside one: that keeps each loop a transform
   or opacity change the browser can composite. `flicker` stretches an element from its top edge (the rocket's
   flame); a test checks every kind used has its CSS.
3. Add its lazy import to `ART` in `JourneyScene.tsx`, and its tokens (light and dark) to `src/theme.css`, plus a
   background colour for `.journey-scene--<id>` in `journeyScene.css` (shown while the art loads).
4. Add it to `ART` in `src/journeys/__tests__/sceneArt.test.ts` (loops, tokens only, both theme values).
5. Check it on a phone and a tablet, portrait and landscape, light and dark, at the start, middle and finish, with
   Sky decoration Full / Reduced / None and with reduced motion.
