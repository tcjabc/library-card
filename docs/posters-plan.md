# Journey posters plan: printable "Cards & posters"

A trace (2026-11-28) of printable journey posters for Grown-ups → Cards, with a throwaway A4 test
print, and the decisions taken from it (at the end). Nothing is built yet.

## The idea

One A4 portrait poster per journey, line art only (white paper, black outlines, no fills, no
greys), for a child to colour in and fill as they read. A central picture runs up the page (down for
Ocean Deep), with one numbered circle and a writing line per book, alternating left and right of the
picture. The poster also has a title, a blank "My name" line, and START and FINISH labels. It prints
from the browser's print dialog (or Save as PDF), like the library cards.

## What the trace found

**The Cards tab today.**
- `CardsTab.tsx` portals a `<div class="print-root">` into `document.body`.
- `cards-print.css` hides it on screen. Under `@media print` it sets `@page { size: A4; margin: 0 }`,
  hides `#root`, shows `.print-root` and adds `print-color-adjust: exact`.
- All sizes are mm (`--print-*` tokens, A4 = 210 × 297 mm). The sheet pads itself.
- Downloads are per-card SVG and PNG (`exportStrip.ts`). There is no PDF download: the print
  dialog's Save as PDF covers it (strings `printTip`, `pdfHint`).
- The production build keeps the print block intact, `-webkit-print-color-adjust` included.

**A problem with that print CSS.**
- It's global, and it stays loaded once Cards has been opened. After that, printing any other
  screen of the app prints a blank page.
- A second portal with the same class would print together with the cards.

**Journey data.** `CONFIG` in `journeys.ts` already has `steps`, `direction` and `stageSteps`, and
`en.ts` has every title and stage label plus `journey.start` / `finishUp` / `finishDown`.
`getJourney()` returns everything a poster needs.

| Journey | Books | Direction | Stage steps |
|---|---|---|---|
| ocean_deep | 5 | down | 2, 4, 5 |
| redwood_tree | 8 | up | 2, 4, 6, 8 |
| ocean_cliff | 10 | up | 2, 5, 8, 10 |
| skyscraper | 12 | up | 3, 6, 9, 12 |
| rapunzel_tower | 15 | up | 3, 7, 11, 15 |
| hot_air_balloon | 20 | up | 4, 8, 12, 16, 20 |
| ladder_to_the_moon | 25 | up | 5, 10, 15, 20, 25 |
| rocket_through_space | 30 | up | 5, 12, 18, 24, 30 |

**Art.**
- The journey scenes can't be reused. They are filled, stretched (`preserveAspectRatio="none"`,
  34 uses) and split into three parallax layers.
- At most a few object paths (the rocket body, the balloon envelope) could seed the new drawings.
- The posters need new line drawings.

## The test print

A throwaway A4 page set (5 books down, 20 up, 30 up) in a 794 × 1123 viewBox (1 unit = 0.2645 mm),
printed to PDF by headless Chrome at 100%, with the page's own `@page` size and no margins.

- **Paper:** 3 pages of 209.9 × 297.0 mm. The 100 mm calibration line measured 99.99 mm.
- **Writing lines:** all 55 measured 65.32 mm.
- **Letter paper with default margins** (the CSS size ignored): Chrome scales to about 94%. Lines
  are 61.45 mm, still above the 60 mm aim.

| Books | Row pitch | Same-side spacing | Circle | Writing line |
|---|---|---|---|---|
| 5 | 42.2 mm | 84.3 mm | 9.5 mm | 65.3 mm |
| 20 | 10.5 mm | 21.1 mm | 9.5 mm | 65.3 mm |
| 30 | 7.0 mm | 14.1 mm | 9.5 mm | 65.3 mm |

- **The real minimum for 30 books:** the row pitch is 7 mm, below the ~8 mm aim. Because the sides
  alternate, each line still has 14 mm of writing height.
- **The circle radius** is 18 units, set by the 84 − 66 gap between the art and the circles. The
  number is about 5 mm tall.
- **A collision:** the FINISH label at y 200 overlapped art that started at y ~190. The labels
  need their own bands (y ≤ 200 at the top, ≥ 1030 at the bottom), and the art must stay inside the
  slot area (y 215–1012).

**Expected but not measured:**
- Printer hardware margins of about 3–5 mm, inside the 9 mm safe margin.
- "Fit to printable area" shrinking about 5%.
- Safari on iOS/iPadOS may ignore `@page size` and use the paper picked in its dialog: fine on A4,
  about 94% on Letter.
- Android prints through its own dialog, with Save as PDF.

## Design

**Placement.**
- A "Journey posters" section below the card sections in Grown-ups → Cards. It's not a seventh
  tab, and there's no sub-navigation.
- It's behind the grown-up gate like the rest of Grown-ups. Posters hold no personal data.
- Contents: journey chips (one or several), a scaled preview, and one Print button.
- `PostersSection` loads as its own lazy chunk inside `CardsTab`.

**Printing.**
- One shared `PrintRoot` for the Cards tab. A print button sets the active job (cards or posters),
  then calls `window.print()` after that commit, so only that job's pages are in the root.
- Hide `#root` only while a job prints, scoped by an attribute on `<html>` (no `:has()`). This also
  fixes the existing blank-page leak.
- One poster per page with `break-after: page`, plus `page-break-after: always` as a fallback.
- Delivery is the print dialog / Save as PDF, consistent with the cards. An SVG download is cheap
  but optional.

**Slot layout.**
- Book 1 sits at the start end: the bottom, or the top for Ocean Deep.
- Sides alternate left and right, evenly spread over y 215–1012.
- Circles sit 84 units either side of the centre (x 397), radius 18 units.
- Each line runs from 8 units past its circle out to the 9 mm margin.
- The art has a fixed size per journey and the slots spread over its full height: 5 books simply
  get more space.

**Art.**
- Per journey, a pure TS module returning path strings for the central column (within ±66 units of
  the centre, y 215–1012).
- Strokes only: `fill="none"`, round caps and joins, 2.5 units (about 0.66 mm), no text.
- About 1–3 KB of path data each; all eight in one lazy chunk, roughly 10 KB gzipped.

**Line weights.** Art about 0.66 mm, circles about 0.53 mm, writing lines about 0.32 mm. No heavy
black areas.

## Files

- `src/posters/posterLayout.ts` (pure): `POSTER_FRAME` and `layoutSlots`.

  ```ts
  export const POSTER_FRAME = {
    width: 794, height: 1123, centre: 397, circleOffset: 84, artHalf: 66,
    slotTop: 215, slotBottom: 1012, margin: 9 / (210 / 794), gap: 8,
  };

  export function layoutSlots(
    steps: number,
    direction: JourneyDirection,
    frame = POSTER_FRAME,
  ): PosterSlot[];

  export type PosterSlot = {
    book: number;
    side: 'left' | 'right';
    cx: number; cy: number; r: number;
    line: { x1: number; x2: number; y: number };
  };
  ```

- `src/posters/art/<journey>.ts`: each returns `{ paths: string[] }`. An index maps journey ids to
  art.
- `src/grownups/cards/JourneyPoster.tsx`: the inline SVG (slots, art, labels), ink as
  `currentColor`.
- `src/grownups/cards/PostersSection.tsx`: lazy; chips, preview, print button.
- A shared `PrintRoot` and `ScaledPage`: `ScaledPage` is local to `CardsTab` today and moves out.
- `posters-print.css`: the poster sheet; the print rules move to the shared, scoped block.

**Tokens** (in the existing print tokens):
- `--poster-ink` (#000) and `--poster-paper` (#fff).
- Reuse `--print-page-width` / `--print-page-height`.

**Strings** (`strings.grownups.posters` in `en.ts`):
- The section heading and intro, and the "Pick journeys" label.
- The print button ("Print poster" / "Print {count} posters").
- The print tip (A4, 100%), reusing the wording of `printTip` / `pdfHint` where it fits.
- The preview alt text.
- On the poster: "My name", START, FINISH, and the caption "My reading journey".
- Journey titles come from `strings.journeys`. Stage labels aren't printed (decision 4).

## Tests (Node)

- **`layoutSlots`**, for every count from 5 to 30 in both directions:
  - one slot per book, alternating sides, in order (reversed for Ocean Deep);
  - no circle overlaps, and nothing inside the art band;
  - everything inside the 9 mm margin;
  - every line at least 60 mm, and same-side spacing at least 12 mm.
- **Art:** stroke-only. No fill other than `none`, no colours, gradients, filters, images or text.
  Path bounds stay inside ±66 units and the slot area.
- **Poster markup** (`renderToStaticMarkup`): one slot per step, the title, START / FINISH and the
  name line from `en.ts`.
- **Print CSS:** present in the built CSS, scoped to the html attribute, extending
  `cssFallbacks.test.ts`.

## Old browsers

The posters need only mm sizes, `@page { size: A4; margin: 0 }` and `break-after: page`, all of
which work on Chrome 103. Safari 15's `@page size` support is the one doubt (above). Scope the print
CSS without `:has()`, and avoid `color-mix()` and individual `translate:`.

## Release plan

- **1.23.0:** the framework plus one pilot poster.
  - The shared print root with scoping (also fixes the blank-page leak).
  - The section, `layoutSlots`, `JourneyPoster`, strings, tokens and tests.
- **1.24.0:** the other seven posters, about 1–2 hours of art each.
- **Pilot (recommended):** Rocket Through Space (30 books), the tightest layout. Its printout settles
  the smallest writable size on real paper. Ocean Deep's top-down order is covered by the layout
  tests.

## Risks

- **The blank-page leak** after visiting Cards. It already exists; fix it in 1.23.0 either way.
- **Two print portals** print together without the shared root.
- **Safari's `@page size` and Letter paper** give about 94% scale. Lines stay above 60 mm.
- **30 books** gives a 7 mm row pitch. The alternating sides keep 14 mm per line, but check a real
  printout with a child's handwriting.

## Decisions

1. **Pilot:** Rocket Through Space (30 books).
2. **Line weight:** art about 0.66 mm, writing lines about 0.32 mm (circles about 0.53 mm).
3. **Several at once:** yes. Pick several journeys (chips plus "All 8") and print them in one go,
   one poster per page.
4. **Extras:** a small "My reading journey: N books" caption, yes. No per-step stage labels:
   children need that space to write the book titles, and 30 labels would crowd the Rocket poster.

Also decided for 1.23.0 (the build brief):

- **Only journeys with poster art are listed.** 1.23.0 ships the Rocket; adding a poster in 1.24.0
  is one art module plus one registry line.
- **The section:** journey chips (several, plus "All"), a scaled preview of the first one picked,
  one Print button ("Print poster" / "Print {count} posters") and a print tip (A4, 100%; background
  graphics can stay off).
- **The print root:** one shared `PrintRoot` for the Cards tab. Printing sets the active job (cards
  or posters), so only that job's pages are in the root. An attribute on `<html>`, set only while a
  job prints, scopes `#root { display: none }` and the print rules. This fixes the blank-page leak.
  Cards print exactly as before.
- **On the poster:** the journey title, the caption, a blank "My name" line, START and FINISH
  (reversed for Ocean Deep), and the footer "Write each book on its line when you finish it.
  Colour me in and decorate!".
- **The art:** white fills are allowed only to hide lines behind a shape. Writing lines are 1.2
  units (about 0.32 mm).
- **Delivery:** the print dialog / Save as PDF only. No PDF or SVG download in this release.
- **The pilot art:** adapted from a hand-drawn seed (rocket at the top, a dotted trail with
  sparkles, the launch pad at the bottom), fitted inside the art band, with its text removed.

Found while building (1.23.0): Android Chrome 103 fires `afterprint` about 0.2 s after `print()`
and then lays the page out again for its preview. Clearing the job on `afterprint` made Android
preview the cards instead of the poster, so a button's job now stays requested until the next tap
or key press. How it works: [posters.md](posters.md).
