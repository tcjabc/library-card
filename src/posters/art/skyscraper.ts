import { circle, fitPosterArt, rect } from './fit';

/**
 * Skyscraper (12 books, up): a tall tower of windows, the mast at the top, the door at the bottom.
 * From the 1.24.0 design canvas, fitted by fitPosterArt.
 */
const WINDOWS = Array.from({ length: 18 }, (_, k) => [367, 388, 409].map((x) => rect(x, 306 + 36 * k, 18, 22, 3)).join('')).join('');

export const skyscraper = fitPosterArt([
  { d: rect(357, 282, 80, 748), fill: 'paper' },
  { d: rect(349, 270, 96, 12), fill: 'paper' },
  { d: 'M397 270V198' },
  { d: circle(397, 190, 6), fill: 'paper' },
  { d: WINDOWS },
  { d: 'M381 1030V996a16 16 0 0 1 32 0V1030', fill: 'paper' },
]);
