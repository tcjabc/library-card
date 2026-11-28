import { fitPosterArt, polygon } from './fit';

/**
 * Ladder to the Moon (25 books, up): a long ladder from the ground up to the moon and stars. From
 * the 1.24.0 design canvas, fitted by fitPosterArt. The canvas's moon had an inner arc too small
 * for its chord (SVG grew it into the outer half-circle, leaving a bare arc): here the inner arc
 * has radius 52, so it draws as a crescent.
 */
const RUNGS = Array.from({ length: 30 }, (_, k) => `M380 ${322 + 24 * k}H414`).join('');

const STARS = [
  '450.0,198.0 452.1,203.1 457.6,203.5 453.4,207.1 454.7,212.5 450.0,209.6 445.3,212.5 446.6,207.1 442.4,203.5 447.9,203.1',
  '446.0,250.0 447.6,253.8 451.7,254.1 448.6,256.8 449.5,260.9 446.0,258.7 442.5,260.9 443.4,256.8 440.3,254.1 444.4,253.8',
  '345.0,283.0 346.9,287.5 351.7,287.8 348.0,291.0 349.1,295.7 345.0,293.1 340.9,295.7 342.0,291.0 338.3,287.8 343.1,287.5',
  '352.0,195.0 353.3,198.2 356.8,198.5 354.1,200.7 354.9,204.0 352.0,202.3 349.1,204.0 349.9,200.7 347.2,198.5 350.7,198.2',
];

export const ladderToTheMoon = fitPosterArt([
  { d: 'M410 186a40 40 0 1 0 0 80a52 52 0 0 1 0 -80z', fill: 'paper' },
  { d: STARS.map(polygon).join('') },
  // Ladder: rails and rungs.
  { d: 'M380 300V1030M414 300V1030' },
  { d: RUNGS },
  // Ground.
  { d: 'M331 1030H463M345 1030l4 -10l4 10M440 1030l4 -10l4 10' },
]);
