import { fitPosterArt } from './fit';

/**
 * Redwood Tree (8 books, up): a tall trunk with bark marks, the three-tier crown at the top, roots
 * at the bottom. From the 1.24.0 design canvas, fitted by fitPosterArt.
 */
const BARK = Array.from({ length: 14 }, (_, k) => `M385 ${380 + 46 * k}v26M409 ${396 + 46 * k}v26`).join('');

export const redwoodTree = fitPosterArt([
  // Crown: each lower tier in front of the one above.
  { d: 'M397 182L360 252H434Z', fill: 'paper' },
  { d: 'M397 222L348 300H446Z', fill: 'paper' },
  { d: 'M397 270L336 356H458Z', fill: 'paper' },
  // Trunk, roots and ground.
  { d: 'M375 356L371 1000Q370 1022 360 1030M419 356L423 1000Q424 1022 434 1030' },
  { d: 'M360 1030q-8 0 -14 -6M434 1030q8 0 14 -6M346 1030H448' },
  // Bark.
  { d: BARK },
]);
