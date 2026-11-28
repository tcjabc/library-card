import { ellipse, fitPosterArt, rect } from './fit';

/**
 * Rapunzel's Tower (15 books, up): a brick tower with Rapunzel's braid hanging from the window,
 * the pointed roof and flag at the top, the door at the bottom. From the 1.24.0 design canvas
 * (the last course's joints stop at the tower's foot), fitted by fitPosterArt.
 */
const TOWER_FOOT = 1030;
const BRICKS = Array.from({ length: 26 }, (_, k) => {
  const y = 364 + 26 * k;
  const joint = Math.min(26, TOWER_FOOT - y);
  const joints = k % 2 === 0 ? [397] : [377, 417];
  return `M357 ${y}H437` + joints.map((x) => `M${x} ${y}v${joint}`).join('');
}).join('');

export const rapunzelTower = fitPosterArt([
  { d: rect(357, 340, 80, 690), fill: 'paper' },
  { d: BRICKS, thin: true },
  // Roof and flag.
  { d: 'M345 340L397 214L449 340Z', fill: 'paper' },
  { d: 'M397 214V186l22 7l-22 7' },
  // Window, then the braid: each lock in front of the one above.
  { d: 'M385 400v-22a12 12 0 0 1 24 0v22z', fill: 'paper' },
  ...Array.from({ length: 22 }, (_, k) => ({ d: ellipse(k % 2 === 0 ? 393 : 401, 412 + 18 * k, 9, 12), fill: 'paper' as const })),
  // Door.
  { d: 'M377 1030V996a20 20 0 0 1 40 0V1030', fill: 'paper' },
]);
