import type { PosterArt, PosterShape } from './types';

/**
 * Rocket Through Space (30 books, up): the rocket at the top (the finish end), a dotted trail with
 * sparkles on the way, the launch pad at the bottom. From the 1.23.0 design-canvas draft, scaled
 * up by 1.3 and fitted inside the art band, with rounder fins.
 */

/** A four-point sparkle about 14 units across, centred on (x, y). */
function sparkle(x: number, y: number): PosterShape {
  const h = 7;
  return { d: `M${x} ${y - h}Q${x} ${y} ${x + h} ${y}Q${x} ${y} ${x} ${y + h}Q${x} ${y} ${x - h} ${y}Q${x} ${y} ${x} ${y - h}Z` };
}

/** Sparkles on alternate sides of the trail, clear of the slots' circles. */
const SPARKLES: readonly [number, number][] = [
  [362, 475],
  [432, 550],
  [362, 630],
  [432, 710],
  [362, 790],
  [432, 870],
  [362, 940],
];

export const rocketThroughSpace: PosterArt = {
  shapes: [
    // Fins first, so the body covers where they join it.
    { d: 'M369 326C352 338 344 360 343 392C351 384 359 372 370 362Z', fill: 'paper' },
    { d: 'M425 326C442 338 450 360 451 392C443 384 435 372 424 362Z', fill: 'paper' },
    // Body.
    { d: 'M397 220C364.5 259 359.3 318.8 367.1 368.2H426.9C434.7 318.8 429.5 259 397 220Z', fill: 'paper' },
    // Window: a rim and the glass.
    { d: 'M382 288A15 15 0 1 0 412 288A15 15 0 1 0 382 288Z' },
    { d: 'M388 288A9 9 0 1 0 406 288A9 9 0 1 0 388 288Z' },
    // Nozzle.
    { d: 'M383 368.2H411L406 381H388Z', fill: 'paper' },
    // Flame: outer and inner.
    { d: 'M386 386Q397 446 408 386' },
    { d: 'M391.5 386Q397 418 402.5 386' },
    // The trail down to the launch pad.
    { d: 'M397 440V960', dots: true },
    ...SPARKLES.map(([x, y]) => sparkle(x, y)),
    // Launch pad: the ground, two legs and the deck.
    { d: 'M347 1008H447M367 1008V982M427 1008V982M357 982H437' },
  ],
};
