# The Family Staircase

The hub's **Family Staircase** tile opens `#/staircase`: one pile of books for the whole household,
newest on top. The screen opens on the newest book; scrolling down goes back in time.

Code: `src/screens/journeys/FamilyStack.tsx` (the screen, loaded on its own), `src/staircase/CanvasStack.tsx`
(the canvas renderer, shared with the developer tools' pretend piles at `#/dev/stack`) and the pure helpers in
`src/staircase/stackItems.ts` (unit-tested). The old zig-zag staircase is still at `#/staircase/old`, linked from
Developer tools, until it's retired.

## What's on the pile

- **One book on the pile = one reader + one book**: that reader's first **confirmed** read of it (a read
  summary). Pending reads (waiting for a grown-up) are not on the pile. The same title read by two readers is on
  the pile twice. Grown-ups' reads count.
- **Order and step numbers**: the same rule as before (`staircaseOrder`): by `first_read_at`, then reader id, then
  ISBN. Step 1 is the bottom of the pile; step N is the household's Nth first read. The total in the title is the
  number of books on the pile.
- A read confirmed later keeps its own `read_at`, so it can land in the middle of the pile. Each book's size and
  wobble are seeded by its reader + ISBN (not its step), so the books above it don't change.
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
  the pitch of the thickest book (so any K + 1 books fit, whatever their sizes and turns). K only decides where the
  pile **starts**:
  - **A pile that fits (N - 1 <= K)** opens on its base book (step 1) at the eye line, the pile rising above it and
    the lower half plain background. Scrolling up eases towards the newest book (the pile then sits below the eye
    line); scrolling back down returns to the base book.
  - **A taller pile** opens on the newest book; scrolling down all the way brings the base book to the eye line.
- Resizing or turning the screen works K out again and keeps the reader's book; the starting rule only applies
  when the screen opens.
- The screen is pinned to the viewport: the page behind it never scrolls or rubber-bands (iOS), and drags on the
  header and the bar don't move anything.

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

## Time zone

A book's month is the month of its `first_read_at` **in the household's time zone** (`households.time_zone`, the
same zone every "today" in the app uses; the device's zone if the household has none). Labels are written with
`Intl.DateTimeFormat` in the app's language (`strings.app.locale`). So a book read at 00:30 on 1 November in Taipei
is a November book even though it's still 31 October in UTC, and daylight saving time is followed.

## Live updates

The pile follows new reads as they happen (also from another tab or device, through sync):

- On the base book, the camera stays on the base book as the pile grows.
- If the reader is at the newest book, the camera eases up to the new newest book.
- A pile growing taller than K doesn't move the camera (no jump).
- Anywhere else, the book in front of them stays in front of them; if it has gone (an undo), the nearest older
  book that's still there takes its place.

## Accessibility

- Screen readers get a hidden list of every book, newest first: "Step N, title, read by reader, date".
- Arrow Up and Down step one book (with the same ease); the pile shows a focus ring when focused from the keyboard.
- With reduced motion, the camera moves without easing.
