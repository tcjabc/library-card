import { PANEL } from './stripLayout';

/**
 * Card templates: outline-only art (no fills), so children can colour the printed card by hand.
 * Each template draws a whole panel in its own coordinates (0–85.6 × 0–54 mm); the strip drawing
 * masks out the QR code, avatar and barcode zones, so art can never cover them.
 */

export const CARD_TEMPLATES = ['plain', 'bubbles', 'rainbow', 'zigzag'] as const;
export type CardTemplate = (typeof CARD_TEMPLATES)[number];
export const DEFAULT_TEMPLATE: CardTemplate = 'bubbles';

export const isCardTemplate = (value: unknown): value is CardTemplate =>
  typeof value === 'string' && (CARD_TEMPLATES as readonly string[]).includes(value);

export type PanelSide = 'front' | 'back';

const W = PANEL.width;
const H = PANEL.height;
const n = (v: number) => String(Math.round(v * 100) / 100);

/** A rounded frame just inside the panel's edge: every template has one. */
function frame(): string {
  return `<rect x="2" y="2" width="${n(W - 4)}" height="${n(H - 4)}" rx="3.5"/>`;
}

const FRONT_BUBBLES: ReadonlyArray<[number, number, number]> = [
  [7, 8, 3.2], [15, 5.5, 1.6], [29, 7, 4.2], [6, 22, 2.2], [33, 19, 2.4], [5.5, 44, 4], [14, 49, 2],
  [31, 45, 3.6], [24, 51, 1.4], [40, 3.2, 1.2], [62, 3.4, 1.3], [83, 26, 1.2], [46, 51, 1.5], [70, 51.2, 1.2],
];
const BACK_BUBBLES: ReadonlyArray<[number, number, number]> = [
  [8, 7, 3], [20, 5, 1.6], [66, 6, 2.4], [78, 9, 3.4], [12, 49.5, 2.6], [28, 50.5, 1.8], [44, 49, 2.2],
  [60, 50.5, 1.6], [76, 48.5, 3], [42, 27, 12], [20, 28, 6], [66, 26, 7.5], [6, 30, 2], [80, 33, 2],
];

function bubbles(side: PanelSide): string {
  const list = side === 'front' ? FRONT_BUBBLES : BACK_BUBBLES;
  return list.map(([cx, cy, r]) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`).join('');
}

/** Concentric half-arcs from a centre on the bottom edge. */
function arcs(cx: number, radii: readonly number[]): string {
  return radii.map((r) => `<path d="M${n(cx - r)} ${n(H)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(H)}"/>`).join('');
}

function cloud(x: number, y: number, s: number): string {
  // Three bumps over a flat base, drawn right to left (sweep 0 bulges upwards).
  const bump = (r: number, dx: number, dy: number) => `a${n(r * s)} ${n(r * s)} 0 0 0 ${n(dx * s)} ${n(dy * s)}`;
  return `<path d="M${n(x)} ${n(y)}h${n(9 * s)}${bump(2.2, -2, -3.6)}${bump(2.6, -4.6, -1.4)}${bump(2.4, -2.4, 5)}z"/>`;
}

function rainbow(side: PanelSide): string {
  if (side === 'front') return arcs(0, [10, 15, 20, 25, 30]) + cloud(4, 13, 1) + cloud(46, 4.5, 0.8);
  return arcs(W / 2, [14, 20, 26, 32, 38]) + cloud(6, 9, 1) + cloud(68, 10, 1);
}

/** Zigzag bands across the panel. */
function zigzagRow(y: number, amp: number, step: number): string {
  const points: string[] = [];
  for (let x = 0, up = true; x <= W + step; x += step, up = !up) points.push(`${n(x)},${n(up ? y - amp : y + amp)}`);
  return `<polyline points="${points.join(' ')}"/>`;
}

function zigzag(): string {
  return [6, 13, 41, 48].map((y) => zigzagRow(y, 2, 4)).join('') + [20, 27, 34].map((y) => zigzagRow(y, 1.4, 3)).join('');
}

/** The template's outline art for one panel (SVG elements, no fills), in panel coordinates. */
export function templateArt(template: CardTemplate, side: PanelSide): string {
  switch (template) {
    case 'plain':
      return frame();
    case 'bubbles':
      return frame() + bubbles(side);
    case 'rainbow':
      return frame() + rainbow(side);
    case 'zigzag':
      return frame() + zigzag();
  }
}
