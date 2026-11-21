/**
 * Small confetti burst from a point (e.g. the button that was pressed).
 * Plain DOM + CSS animation, no library. Does nothing when the user prefers
 * reduced motion. Colours come from --confetti-* tokens in theme.css.
 */

const PIECES = 26;
const DURATION_MS = 900;
const COLOURS = 5;

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ConfettiOptions {
  /** 'big' throws more pieces, further: for celebrations. */
  size?: 'small' | 'big';
}

export function confettiBurst(from: Element | { x: number; y: number }, options: ConfettiOptions = {}): void {
  if (prefersReducedMotion()) return;
  const point =
    from instanceof Element
      ? (() => {
          const r = from.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      : from;

  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${point.x}px`;
  layer.style.top = `${point.y}px`;

  const big = options.size === 'big';
  const pieces = big ? PIECES * 2 : PIECES;
  for (let i = 0; i < pieces; i++) {
    const piece = document.createElement('span');
    const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.4;
    const distance = big ? 110 + Math.random() * 200 : 60 + Math.random() * 70;
    piece.className = 'confetti__piece';
    piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--dy', `${Math.sin(angle) * distance - 40}px`);
    piece.style.setProperty('--spin', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.background = `var(--confetti-${(i % COLOURS) + 1})`;
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), DURATION_MS + 100);
}
