# Journey posters

Printable reading-journey posters, in Grown-ups → Cards → "Journey posters" (1.23.0). One A4
portrait poster per journey: line art for a child to colour in, with a numbered circle and a
writing line for each book they finish. The plan and the decisions behind it are in
[posters-plan.md](posters-plan.md).

## On screen

- **Placement:** the section sits below the card sections on the Cards tab, behind the grown-up gate
  like the rest of Grown-ups. It loads as its own chunk (`PostersSection`).
- **Picking:** journey chips, several at once, plus "All". Only journeys with poster art are listed.
- **Preview:** a scaled preview of the first poster picked.
- **Print:** one button ("Print poster" / "Print {count} posters"), with the print tip (A4, 100%).
- **Delivery:** the print dialog, or its "Save as PDF". There's no file download.

A poster holds no personal data: the "My name" line is blank, for the child to write.

## The page

Everything is in the poster's own units: a 794 × 1123 viewBox printed at 210 × 297 mm, so 1 unit
is 0.2645 mm both ways (`src/posters/posterLayout.ts`).

| Band | y (units) | What |
|---|---|---|
| Top labels | ≤ 200 | Title, "My reading journey: N books", the "My name" line, then FINISH (START for Ocean Deep) |
| Art | 215–1012 | The journey's drawing within ±66 of the centre (x 397), and the slots either side |
| Bottom labels | ≥ 1030 | START (FINISH for Ocean Deep), then the footer |

Nothing is drawn in the 9 mm safe margin (34 units).

**The slots** come from `layoutSlots(steps, direction)`:
- Book 1 sits at the start end: the bottom, or the top for a journey that goes down.
- Books alternate left and right, evenly spread over the art band.
- Circles sit 84 units either side of the centre, radius 18 (9.5 mm across), with the number inside.
- Each writing line runs from beside its circle out to the margin. Every line is 65.3 mm long.
- At 30 books the rows are 7 mm apart and same-side lines 14 mm apart.

**Line weights** (`POSTER_STROKES`): art 2.5 units (0.66 mm), circles 2 (0.53 mm), writing lines
1.2 (0.32 mm). Caps and joins are round.

**Ink:** `--poster-ink` (#000) on `--poster-paper` (#fff), in every theme. There are no stage
labels on the poster: the space is for book titles.

## Printing

Cards and posters print through one shared print root (`src/ui/print`):

- **`PrintRoot`** wraps the Cards tab. `<PrintPages job="cards">` and `<PrintPages job="posters">`
  render their pages into the root only while that job prints, so only one job's pages are ever in
  it.
- **`printJob.ts`** sets `data-print-job` on `<html>` and adds the A4 page rule
  (`@page { size: A4; margin: 0 }`) only while a job prints, then removes both. Every print rule in
  `print.css` is scoped to `html[data-print-job]`, so printing any other screen prints that screen.
  Before 1.23.0 the card print rules were global, and after visiting Cards any other screen printed
  as a blank page.
- **The browser's own Print** (Ctrl+P, the menu) on the Cards tab prints the cards (the fallback
  job), as before.
- **Android Chrome** fires `afterprint` about 0.2 s after `print()` returns. It then lays the page
  out again for its own preview, with a new `beforeprint` / `afterprint` pair, and again when the
  paper changes. So the job a button asked for stays requested through every pass, until the next
  tap or key press on the page (`createPrintJobs`, with tests for the desktop and Android
  sequences). Without that, Android's preview showed the cards instead of the poster.

Old browsers (Chrome 103, Safari 15): sizes are in mm, each poster sheet has
`break-after: page` plus `page-break-after: always`, and nothing newer is used. The build test
(`cssFallbacks.test.ts`) checks these print rules survive the minifier.

## Adding a poster (1.24.0)

1. **Draw it** in `src/posters/art/<journeyName>.ts`, exporting a `PosterArt`
   (`src/posters/art/types.ts`): a list of shapes, each a path `d`.
   - Use absolute `M L H V C Q A Z` commands only.
   - Optional `fill: 'paper'` (white, to hide lines behind a shape) and `dots: true` (a dotted line).
   - No text and no colours: titles and labels come from `en.ts`.
2. **Register it** with one line in `POSTER_ART` (`src/posters/art/index.ts`). The section lists it
   at once, in gallery order.
3. **Keep it inside the frame:**
   - y 215–1012 and within ±66 of x 397, strokes included.
   - At least 1 mm clear of every slot circle (in practice within about ±60).
   - Simple and bold, with large empty areas to colour.
4. **Run `npm test`.** `posterArt.test.ts` checks every registered poster: stroke-only, the bounds
   and the clearance. Update its "1.23.0 ships the pilot only" list. `posterLayout.test.ts` already
   covers every count from 5 to 30 in both directions.
5. **Print it to PDF at 100% and look:**
   - Lines at least 60 mm.
   - Nothing in the margin.
   - The art clear of the circles and labels.

   Ocean Deep is the one journey that goes down: START at the top, book 1 at the top.
