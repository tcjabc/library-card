import { fitPosterArt, rect } from './fit';

/**
 * Hot-Air Balloon (20 books, up): the balloon at the top, a dotted way up past four clouds, hills
 * at the bottom. From the 1.24.0 design canvas, fitted by fitPosterArt.
 */
const cloud = (x: number, y: number) => `M${x} ${y}q-8 -12 6 -14q4 -12 16 -4q12 -4 12 8q8 3 2 10z`;

export const hotAirBalloon = fitPosterArt([
  // Envelope and its gores.
  { d: 'M397 190C335 190 335 270 350 300C358 316 372 326 382 334H412C422 326 436 316 444 300C459 270 459 190 397 190Z', fill: 'paper' },
  { d: 'M397 190C378 220 378 300 388 334M397 190C416 220 416 300 406 334M374 198C354 238 358 288 370 322M420 198C440 238 436 288 424 322' },
  // Basket and ropes.
  { d: rect(385, 356, 24, 22), fill: 'paper' },
  { d: 'M382 334L385 356M412 334L409 356' },
  // The way up, behind the clouds.
  { d: 'M397 384V990', dots: true },
  { d: cloud(342, 480), fill: 'paper' },
  { d: cloud(404, 640), fill: 'paper' },
  { d: cloud(342, 800), fill: 'paper' },
  { d: cloud(404, 920), fill: 'paper' },
  // Hills.
  { d: 'M331 1030q33 -40 66 0q33 -30 66 0' },
]);
