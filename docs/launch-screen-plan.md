# Launch screen plan: the animated bookcase in the splash header

A trace (2026-11-28) and the decisions taken from it, for 1.22.0. How it works once built is in
[launch.md](launch.md).

## The idea

When the app starts, a bookcase assembles from simple shapes and fills with books of varied
colours and sizes, in the splash's header (where the 📚 was). It plays while the app loads and
never adds wait time: the Scan button, the reader tiles and the Grown-ups link are there and
usable from the first frame.

## What the trace found

**Boot** (live 1.21.1 site, headless Chrome 157, phone 390 × 844, ms from navigation):

| | First paint | Splash rendered | Reader tiles | Long tasks |
|---|---|---|---|---|
| First visit, 1× (no data) | 860 | 985 | – | – |
| First visit, 4× | 880 | 927 | 1,345 | 174 |
| Relaunch (warm service worker), 1× | 124 | 116–125 | 207–224 | – |
| Relaunch, 4× | 328 | 250 | 633 | 54, 53, 168 |
| Relaunch, 4×, dark | 440 | 195 | 535 | 193 |
| Same-tab reload, 1× / 4× | 108 / 116 | 77 / 140 | 88 / 182 | – |

- `index.html` has an empty `#root` and no static shell. The theme CSS is a render-blocking link, so
  the first paint already has the theme background (light or dark). On screen: blank, then the
  background, then the splash (button and Grown-ups link) without tiles, then the tiles 0.1–0.4 s later
  (they wait for the local adapter chunk and IndexedDB).
- On a relaunch the splash is usable at about 0.12–0.25 s, so a blocking 2-second overlay would add up
  to about 1.8 s. Hence the shelf lives in the header and never covers anything.
- The web manifest's `background_color` is light only, so Android's own launch splash is cream in
  dark mode (a manifest can't vary by theme). iOS shows its own blank screen.

**Cold start.** A resumed PWA and a back/forward-cache restore don't reload. Update reloads
(`autoUpdate` taking over, "Check for updates", the database-upgrade reload) are navigation type
`reload` in the same tab, so `sessionStorage` survives them. A relaunched app (including iOS killing a
backgrounded standalone PWA) is a new document with an empty `sessionStorage`. iOS isn't verified here.

**Motion.** The per-visit slow-device budget (drawBudget.ts, sceneBudget.ts) needs about 1 s over at
least 30 frames, and the boot's own long tasks (up to ~190 ms at 4×) would make every device look
slow. CSS animations of whole elements run on the compositor, so they keep moving through that jank.
No frame sampling at launch.

**Art.** Animating shapes inside an SVG repaints on the main thread every frame (found in 1.20.0
with the rocket's flame); whole HTML boxes animated by transform/opacity are composited. About 25
small layers while it plays (about 1–2 MB at 3×), dropped when it finishes.

**Real cover colours** (later): `library-card:cover-colours` is synchronous localStorage, at most
2,000 entries (127 KB); parsing it and taking the newest 18 took 0.36 ms on a desktop. No network or
sync wait; device-local; cleared by "Reset this device". Run them through `spineColours()`
(coverColour.ts).

## Decisions

1. The shelf is the splash header, rendered in the same first commit as the splash. No overlay, no
   static shell in index.html, no separate route. It never blocks, covers or delays anything.
2. After it plays, the finished shelf stays: it is the header. Reduced motion, Sky decoration None,
   or not a cold start: the finished shelf at once.
3. Real cover colours are not in 1.22.0. The palette module takes an optional list of colours and
   falls back to tokens, ready for them.
4. Plain HTML boxes animated by transform/opacity only, in the main bundle (not a lazy chunk): 8
   structure parts and 18 books, at most 25 animated, `aria-hidden`, `pointer-events: none`, no
   strings, no focus changes.
5. Cold-start rule (pure, tested): play only if the initial hash is `#/` or empty, the navigation
   type is `navigate`, `sessionStorage['library-card:launch-seen']` is absent, and the motion rules
   allow it. The flag is set as soon as it plays (right after the first commit). Resumed PWAs,
   back/forward restores, reloads and every deep route (`#/card/<token>`, `#/scan`, …) never play it,
   and neither does a second visit to the splash in the same page.
6. Motion levels: Sky decoration None or system reduced motion → the finished shelf at once; Reduced
   → the books fade in on a built shelf (about 0.6 s); Full → the whole build. No frame sampling.
7. Skip: any `pointerdown`/`keydown` finishes it at once, from a passive capture-phase listener that
   doesn't stop the event (the tap still reaches its button). The animations use `fill-mode:
   backwards`, so the natural layout is the final one and finishing just removes them; `will-change`
   goes at the end (a timer at about 1.8 s).
8. Timing (Full): the sides rise 0–250 ms; the boards slide in 150–450 ms; 18 books drop from 350 ms,
   60 ms apart, 420 ms each with a small bounce: done by about 1.8 s (cap 2 s, asserted from the
   constants).
9. Phone landscape (the header is one row at `max-height: 30rem`): a smaller height.
10. Old browsers: no viewport units; no individual `translate:`, `color-mix()`, `:has()` or
    range-syntax media queries. Checked on the production build on Chrome 103.

## Layout

- `src/launch/launchRule.ts`: the rule, the state machine and the timing constants (pure).
- `src/launch/launchPalette.ts`: the books' colours: real ones when given, tokens otherwise (pure).
- `src/screens/LaunchShelf.tsx` + `launchShelf.css`: the shelf.
- `src/ui/useReducedMotion.ts`: a shared hook (used by the shelf; the four older copies in
  JourneyScene, CanvasStack, FamilyStack and confetti.ts can move to it later).
- Tests in `src/launch/__tests__/`.
- Tokens (light and dark): `--launch-wood`, `--launch-wood-shade`, `--launch-back`,
  `--launch-shadow`, `--launch-book-1` … `-8`, `--launch-book-band`, and the timing tokens
  (`--duration-launch` 1.8 s, `--duration-launch-drop` 420 ms, `--launch-stagger` 60 ms and the
  others the build needs).

## Release

1.22.0: the shelf with the token palette. Real cover colours can follow as their own small release
(see launch.md, "Real colours").
