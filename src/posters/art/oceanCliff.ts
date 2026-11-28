import { fitPosterArt } from './fit';

/**
 * Ocean Cliff (10 books, up): a rocky cliff rising from the sea, the lighthouse at the top. From
 * the 1.24.0 design canvas, fitted by fitPosterArt.
 */
export const oceanCliff = fitPosterArt([
  // The cliff and its cracks.
  {
    d: 'M342 1030L350 940L340 860L354 770L346 680L358 590L349 500L362 410L355 330L368 276H426L439 330L432 410L445 500L436 590L448 680L440 770L454 860L444 940L452 1030',
    fill: 'paper',
  },
  { d: 'M370 420l10 14l-6 14M425 600l-12 16l8 16M380 800l14 10M420 900l-14 12' },
  // Lighthouse: tower, bands, lantern, roof, beams.
  { d: 'M385 276L390 206H404L409 276Z', fill: 'paper' },
  { d: 'M388 236H406M386 256H408' },
  { d: 'M389 206V190H405V206' },
  { d: 'M386 190L397 176L408 190Z', fill: 'paper' },
  { d: 'M388 194l-18 -8M388 200l-18 6M406 194l18 -8M406 200l18 6' },
  // The sea at the foot.
  { d: 'M331 1036q8.25 -12 16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0t16.5 0' },
]);
