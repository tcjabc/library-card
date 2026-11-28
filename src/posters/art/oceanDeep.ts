import { circle, ellipse, fitPosterArt, rect } from './fit';

/**
 * Ocean Deep (5 books, down: book 1 at the top). Waves at the top, a submarine diving past bubbles
 * and two fish, the treasure chest on the sea floor at the finish. From the 1.24.0 design canvas
 * (its TREASURE! label dropped: the poster's FINISH label is enough), fitted by fitPosterArt.
 */
export const oceanDeep = fitPosterArt([
  // Waves.
  { d: 'M331 196q8.25 -14 16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0' },
  // Submarine: hull, tower, periscope, portholes, propeller.
  { d: ellipse(397, 248, 50, 20), fill: 'paper' },
  { d: rect(383, 216, 28, 14, 4), fill: 'paper' },
  { d: 'M397 216v-12h10' },
  { d: circle(377, 248, 6) + circle(397, 248, 6) + circle(417, 248, 6) },
  { d: 'M347 248l-12 -12v24z', fill: 'paper' },
  // The way down, ending short of the chest lid (the canvas had V960).
  { d: 'M397 270V945', dots: true },
  // Bubbles (the one by the second fish nudged up from y 760, so it doesn't touch the fish).
  { d: circle(412, 320, 6) + circle(384, 400, 9) + circle(414, 520, 5) + circle(382, 640, 7) + circle(412, 744, 9) + circle(386, 880, 6) },
  // Two fish (a tiny circle in the ink weight reads as a dot for the eye).
  { d: 'M340 560q14 -13 28 0q-14 13 -28 0zM368 560l11 -9v18z' + circle(349, 557, 1.8) },
  { d: 'M455 780q-14 -13 -28 0q14 13 28 0zM427 780l-11 -9v18z' + circle(446, 777, 1.8) },
  // Sea floor, treasure chest, seaweed.
  { d: 'M333 1008q16.5 -12 33 0t33 0t33 0t33 0' },
  { d: rect(372, 968, 50, 32, 4), fill: 'paper' },
  { d: 'M372 972a25 20 0 0 1 50 0M372 972H422' },
  { d: circle(397, 986, 5) },
  { d: 'M345 1004q-9 -18 0 -34t0 -34M449 1004q9 -18 0 -34t0 -34' },
]);
