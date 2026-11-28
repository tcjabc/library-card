import { useEffect, useState, type CSSProperties } from 'react';
import { launchBookColours } from '../launch/launchPalette';
import { markLaunchShown, pageLaunchMode } from '../launch/launchPage';
import { LAUNCH_BOOKS_PER_ROW, LAUNCH_TIMING, launchStep, type LaunchPhase } from '../launch/launchRule';
import { useStackDecor } from '../staircase/decorSetting';
import { useReducedMotion } from '../ui/useReducedMotion';
import './launchShelf.css';

/** The books' sizes (% of their shelf's width and height): two rows of nine, varied. */
const BOOK_SIZES: readonly (readonly [width: number, height: number])[] = [
  [9, 80], [11, 94], [7.5, 70], [12, 88], [10, 96], [8.5, 74], [13, 86], [8, 78], [11, 92],
  [12, 90], [8, 76], [10, 96], [9, 82], [13, 72], [7.5, 94], [11, 84], [9.5, 88], [10, 78],
];

/** Books with a pale band across the spine (every third, starting with the second). */
const hasBand = (index: number) => index % 3 === 1;

/**
 * The splash's header (docs/launch.md): a bookcase that, on a cold start of the app, assembles and
 * fills with books (Full: about 1.8 s; Reduced: the books fade in, about 0.6 s), then stays as the
 * finished shelf. Any tap or key finishes it at once and still reaches its button. Decorative:
 * hidden from screen readers, never takes a tap, no text.
 */
export function LaunchShelf({ colours = null }: { colours?: readonly string[] | null }) {
  const decor = useStackDecor();
  const reduced = useReducedMotion();
  const [mode] = useState(() => pageLaunchMode(decor, reduced));
  const [phase, setPhase] = useState<LaunchPhase>(() => launchStep('idle', { type: 'start', mode }));
  const playing = phase === 'playing';

  // On screen: later visits show it finished, and a play sets the session flag (launchPage.ts).
  useEffect(() => {
    markLaunchShown(mode !== 'still');
  }, [mode]);

  // While it plays: done at the end, or at once on any tap or key (which still reaches its target).
  useEffect(() => {
    if (!playing) return;
    const skip = () => setPhase((p) => launchStep(p, { type: 'skip' }));
    const end = window.setTimeout(() => setPhase((p) => launchStep(p, { type: 'end' })), LAUNCH_TIMING.total);
    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', skip, options);
    window.addEventListener('keydown', skip, options);
    return () => {
      window.clearTimeout(end);
      window.removeEventListener('pointerdown', skip, options);
      window.removeEventListener('keydown', skip, options);
    };
  }, [playing]);

  // Reduced motion or Sky decoration None turned on while it plays: the finished shelf at once.
  const shown = playing && !reduced && decor !== 'none' ? mode : 'done';
  const bookColours = launchBookColours(colours);
  const books = (row: 0 | 1) =>
    BOOK_SIZES.slice(row * LAUNCH_BOOKS_PER_ROW, (row + 1) * LAUNCH_BOOKS_PER_ROW).map(([width, height], k) => {
      const i = row * LAUNCH_BOOKS_PER_ROW + k;
      return (
        <span
          key={i}
          className={`launch-shelf__book${hasBand(i) ? ' launch-shelf__book--band' : ''}`}
          style={{ width: `${width}%`, height: `${height}%`, background: bookColours[i], '--i': i } as CSSProperties}
        />
      );
    });

  return (
    <div className={`launch-shelf launch-shelf--${shown}`} data-launch={shown} aria-hidden="true">
      <div className="launch-shelf__case">
        <span className="launch-shelf__back" />
        <span className="launch-shelf__side launch-shelf__side--left" />
        <span className="launch-shelf__side launch-shelf__side--right" />
        <span className="launch-shelf__board launch-shelf__board--top" style={{ '--i': 0 } as CSSProperties} />
        <span className="launch-shelf__board launch-shelf__board--middle" style={{ '--i': 1 } as CSSProperties} />
        <span className="launch-shelf__board launch-shelf__board--bottom" style={{ '--i': 2 } as CSSProperties} />
        <span className="launch-shelf__row launch-shelf__row--upper">{books(0)}</span>
        <span className="launch-shelf__row launch-shelf__row--lower">{books(1)}</span>
      </div>
    </div>
  );
}
