import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';
import { Cloud } from './parts';

/**
 * Rapunzel's Tower (15 steps, climbing UP the tower): a storybook dawn, peach
 * and lilac at the bottom to light blue at the top. Far: rolling hills with a
 * small distant castle and a few tiny birds. Mid: the tall stone tower behind
 * the track with brick courses and ivy, two arched windows glowing, the slate
 * roof with a flag and the window with the long golden braid at the finish (top)
 * end, a bird drifting. Near: leafy branches from both edges, a meadow with
 * flowers at the start (bottom) end, falling petals and a small cloud passing.
 * Loops (Full decor only): 10.
 */
export default function RapunzelTowerScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('rapunzel-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('rapunzel-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('rapunzel-sky-low')} />
        </svg>
        <svg className="scene-art scene-art--faint" style={at({ left: '-10%', bottom: '0', width: '120%', height: '34%' })} viewBox="0 0 400 140" preserveAspectRatio="none">
          <path d="M0 70 C 60 40 130 44 200 64 C 270 84 330 46 400 56 L 400 140 L 0 140 Z" style={paint('rapunzel-hill-far')} />
          <path d="M0 100 C 80 78 160 86 240 98 C 310 108 360 88 400 94 L 400 140 L 0 140 Z" style={paint('rapunzel-hill-near')} />
        </svg>
        <svg className="scene-art scene-art--faint" style={at({ right: '14%', bottom: 'calc(34% - 2.4rem)', width: '3.4rem' })} viewBox="0 0 40 30">
          {/* A small distant castle. */}
          <path d="M4 30 L 4 12 L 8 12 L 8 8 L 12 8 L 12 12 L 16 12 L 16 4 L 20 0 L 24 4 L 24 12 L 28 12 L 28 8 L 32 8 L 32 12 L 36 12 L 36 30 Z" style={paint('rapunzel-castle')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow" style={at({ left: '10%', top: '16%', width: '3.2rem' })} viewBox="0 0 60 24">
          <path d="M2 10 q 5 -6 10 0 q 5 -6 10 0 M30 4 q 4 -5 8 0 q 4 -5 8 0 M44 16 q 3 -4 6 0 q 3 -4 6 0" style={ink('rapunzel-bird', 1.6)} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        {/* The stone tower behind the track, with brick courses and ivy up one side. */}
        <svg className="scene-art" style={at({ left: 'calc(50% - 5rem)', top: '16rem', width: '10rem', height: 'calc(100% - 16rem)' })} viewBox="0 0 100 1000" preserveAspectRatio="none">
          <rect width="100" height="1000" style={paint('rapunzel-stone')} />
          <path d="M0 60 L 100 60 M0 140 L 100 140 M0 220 L 100 220 M0 300 L 100 300 M0 380 L 100 380 M0 460 L 100 460 M0 540 L 100 540 M0 620 L 100 620 M0 700 L 100 700 M0 780 L 100 780 M0 860 L 100 860 M0 940 L 100 940" style={ink('rapunzel-brick', 2)} />
          <path d="M0 300 C 14 340 4 380 16 420 C 26 460 6 500 18 540 C 28 580 8 620 20 660 C 30 700 10 740 22 780 L 0 800 Z" style={paint('rapunzel-ivy')} />
        </svg>
        <svg className="scene-art" style={at({ left: 'calc(50% - 6.2rem)', top: '8rem', width: '12.4rem', height: '8.4rem' })} viewBox="0 0 124 84">
          {/* The pointed slate roof. */}
          <path d="M0 84 L 62 0 L 124 84 Z" style={paint('rapunzel-roof')} />
          <path d="M14 84 L 62 18 M110 84 L 62 18" style={ink('rapunzel-roof-line', 2)} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--sway" style={at({ left: 'calc(50% - 0.1rem)', top: '6rem', width: '2rem', height: '2.4rem' })} viewBox="0 0 20 24">
          <path d="M1 24 L 1 0" style={ink('rapunzel-roof-line', 2)} />
          <path d="M2 1 L 18 5 L 2 10 Z" style={paint('rapunzel-flag')} />
        </svg>
        {/* The window at the top with the long golden braid. */}
        <svg className="scene-art" style={at({ left: 'calc(50% + 1rem)', top: '17rem', width: '2.2rem', height: '14rem' })} viewBox="0 0 22 140" preserveAspectRatio="none">
          <path d="M2 22 L 2 8 Q 11 -2 20 8 L 20 22 Z" style={paint('rapunzel-window')} />
          <path d="M11 18 Q 6 26 11 34 Q 16 42 11 50 Q 6 58 11 66 Q 16 74 11 82 Q 6 90 11 98 Q 16 106 11 114 Q 6 122 11 130" style={ink('rapunzel-braid', 5)} />
          <circle cx="11" cy="134" r="4" style={paint('rapunzel-braid')} />
        </svg>
        <ArchedWindow left="calc(50% - 3.6rem)" top="38%" />
        <ArchedWindow left="calc(50% + 1.6rem)" top="64%" />
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '8%', top: '30%', width: '2.2rem' })} viewBox="0 0 40 16">
          <path d="M2 10 Q 10 0 20 8 Q 30 0 38 10" style={ink('rapunzel-bird', 2.4)} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-20%', top: '36%', width: '7rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway" style={at({ left: '-9%', top: '20%', width: '9rem' })} viewBox="0 0 120 80">
        <Branch />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway-back" style={at({ right: '-9%', top: '54%', width: '9.5rem' })} viewBox="0 0 120 80">
        <g transform="translate(120 0) scale(-1 1)">
          <Branch />
        </g>
      </svg>
      <svg className="scene-art scene-loop scene-loop--fall" style={at({ left: '18%', top: '26%', width: '0.9rem' })} viewBox="0 0 20 12">
        <ellipse cx="10" cy="6" rx="9" ry="4" style={paint('rapunzel-petal')} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--fall-slow" style={at({ right: '20%', top: '50%', width: '0.8rem' })} viewBox="0 0 20 12">
        <ellipse cx="10" cy="6" rx="9" ry="4" style={paint('rapunzel-petal')} />
      </svg>
      {/* The meadow with flowers at the start end, past the screen's edges; tall enough to clear a browser toolbar over the bottom. */}
      <svg className="scene-art" style={at({ left: '-10%', bottom: '0', width: '120%', height: 'max(11rem, 17vh)' })} viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 30 C 90 16 170 26 240 24 C 310 22 360 32 400 28 L 400 100 L 0 100 Z" style={paint('rapunzel-meadow')} />
        <circle cx="40" cy="32" r="4" style={paint('rapunzel-flower-pink')} />
        <circle cx="96" cy="34" r="3.5" style={paint('rapunzel-flower-yellow')} />
        <circle cx="150" cy="30" r="4" style={paint('rapunzel-flower-white')} />
        <circle cx="262" cy="31" r="4" style={paint('rapunzel-flower-pink')} />
        <circle cx="318" cy="35" r="3.5" style={paint('rapunzel-flower-yellow')} />
        <circle cx="368" cy="33" r="4" style={paint('rapunzel-flower-white')} />
        <circle cx="70" cy="46" r="3.5" style={paint('rapunzel-flower-white')} />
        <circle cx="340" cy="48" r="3.5" style={paint('rapunzel-flower-pink')} />
      </svg>
    </>
  );
}

/** An arched tower window whose warm light glimmers (Full decor only). */
function ArchedWindow({ left, top }: { left: string; top: string }) {
  return (
    <>
      <svg className="scene-art" style={at({ left, top, width: '2rem' })} viewBox="0 0 20 28">
        <path d="M1 28 L 1 10 Q 10 -1 19 10 L 19 28 Z" style={paint('rapunzel-window')} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--glimmer" style={at({ left, top, width: '2rem' })} viewBox="0 0 20 28">
        <path d="M4 26 L 4 11 Q 10 3 16 11 L 16 26 Z" style={paint('rapunzel-glow')} />
      </svg>
    </>
  );
}

/** A leafy branch reaching in from the left edge. */
function Branch() {
  return (
    <>
      <path d="M0 40 C 40 36 80 44 120 38" style={ink('rapunzel-branch', 4)} />
      <ellipse cx="36" cy="30" rx="30" ry="18" style={paint('rapunzel-leaves')} />
      <ellipse cx="76" cy="46" rx="28" ry="16" style={paint('rapunzel-leaves-dark')} />
      <ellipse cx="100" cy="32" rx="18" ry="11" style={paint('rapunzel-leaves')} />
    </>
  );
}
