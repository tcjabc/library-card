# The launch shelf (since 1.22.0)

The splash's header is a bookcase. On a cold start of the app it assembles and fills with books;
after that (and whenever it doesn't play) it is simply the finished shelf. It is decorative and
never blocks anything: the Scan button, the reader tiles and the Grown-ups link (with its gate) are
there and usable from the first frame. The plan and the measurements behind it are in
[launch-screen-plan.md](launch-screen-plan.md).

- **Where**: `src/launch/launchRule.ts` (pure, unit-tested: whether it plays, the state machine,
  the timing), `src/launch/launchPalette.ts` (the book colours, pure), `src/launch/launchPage.ts`
  (the once-per-page decision from the browser), `src/screens/LaunchShelf.tsx` and
  `launchShelf.css`, rendered by `ReaderPicker` in `src/screens/Splash.tsx`. In the main bundle (it
  renders in the splash's first commit; a lazy chunk would pop in after it).
- **When it plays** (`launchMode`): only if the page started at the splash (`#/` or no hash; any
  deep link, `#/card/<token>`, `#/scan` and so on, never plays it), was reached by a fresh navigation
  (not a reload: update reloads, "Check for updates" and the database-upgrade reload are reloads; not
  back/forward), and it hasn't played in this tab yet (sessionStorage `library-card:launch-seen`, set
  right after the shelf's first commit when it plays; sessionStorage ends with the tab, so "Reset
  this device" needn't clear it). A resumed app or a page restored from the back/forward cache
  doesn't reload, so nothing replays. Later visits to the splash in the same page show the finished
  shelf (`launchPage.ts`).
- **Motion**: Sky decoration Full builds it all; Reduced keeps the case built and fades the books
  in; None, or the system's reduced motion, shows the finished shelf at once. Turning either off
  while it plays finishes it. There is no frame sampling at launch: the slow-device budget needs a
  second of frames, and the app's own start-up work would make every device look slow; the
  animations run on the compositor, so that work doesn't stall them.
- **The state machine** (`launchStep`): idle → playing → done. A skip (any `pointerdown` or
  `keydown`, from a passive capture-phase listener that doesn't stop the event, so the tap still
  reaches its button) or the end (a timer at `--duration-launch`, 1.8 s) finishes it.
- **Timing** (`LAUNCH_TIMING`, mirrored by tokens in `src/theme.css`, a test keeps them equal):
  Full: the back fades and the sides rise over 250 ms; the three boards slide in from 150 ms, 60 ms
  apart, 180 ms each (done at 450 ms); the 18 books drop from 350 ms, 60 ms apart, 420 ms each with a
  small bounce (the last lands at 1,790 ms). Reduced: the books fade in, 20 ms apart, 260 ms each
  (600 ms). Never more than 2 s (`LAUNCH_CAP_MS`, tested).
- **Art**: plain HTML boxes, no SVG: a back, two sides, three boards and two rows of nine books of
  varied widths and heights (every third with a pale band). Only `transform` and `opacity` animate,
  each part one animation with `fill-mode: backwards`, so the natural layout is the finished shelf and
  finishing early just removes the class. `will-change` only while it plays. 24 animated parts (at
  most 25), about 30 elements. `aria-hidden`, `pointer-events: none`, no text.
- **Sizes**: `--launch-shelf-width` 15 rem by `--launch-shelf-height` 6 rem; on a phone on its side
  (the splash header is one row, `max-height: 30rem`) 9 by 3.5 rem. No viewport units.
- **Colours**: tokens only, light and dark: `--launch-wood`, `--launch-wood-shade`,
  `--launch-back`, `--launch-shadow`, `--launch-book-band` and `--launch-book-1` … `-8` (each book
  colour 4:1 or more against the back in both themes; a test keeps it at 3:1 or more). The books take
  the palette in steps of three, so neighbours differ and all eight appear.

## Real colours (later)

`launchBookColours(given)` takes an optional list of `#rrggbb` colours and uses them first, the
palette for the rest, so the shelf can show the household's own covers without other changes:

1. Read `library-card:cover-colours` (localStorage, written by the Family Staircase:
   `parseColours` in `src/staircase/coverColour.ts`; at most 2,000 entries, newest last, parsed in
   well under a millisecond on a desktop). Skip the empty entries.
2. Take the newest 18 and run each through `spineColours()` (same file) so they look like spines.
3. Pass them as `<LaunchShelf colours={…} />`. First run or an empty library: no colours, the palette.

These are data, not tokens (the same exception as the stack's covers); keep the art test's "no
colour in the markup" check for the palette case.
