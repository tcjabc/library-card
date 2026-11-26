import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';

/**
 * Ocean Deep (5 steps, going DOWN: the start is at the top). Water in bands from
 * light at the top to deep navy at the bottom, a light wave line along the very
 * top. Far: faint light rays and two tiny faint fish. Mid: rising bubbles, an
 * orange and a teal fish drifting, a pink jellyfish bobbing. Near: a sandy sea
 * floor at the finish (bottom) end, past the screen's edges, two swaying
 * seaweed strands, a treasure chest, and a big dark fish passing slowly.
 * Loops (Full decor only): 13.
 */
export default function OceanDeepScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('ocean-water-top')} />
          <rect y="100" width="100" height="100" style={paint('ocean-water-mid')} />
          <rect y="200" width="100" height="100" style={paint('ocean-water-deep')} />
        </svg>
        <svg className="scene-art" style={at({ left: '0', top: '0', width: '100%', height: '1rem' })} viewBox="0 0 400 16" preserveAspectRatio="none">
          <path d="M0 8 Q 25 0 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 L 400 0 L 0 0 Z" style={paint('ocean-wave')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--glimmer" style={at({ left: '0', top: '0', width: '100%', height: '55%' })} viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M12 0 L 22 0 L 36 100 L 20 100 Z" style={paint('ocean-ray')} />
          <path d="M44 0 L 52 0 L 62 100 L 48 100 Z" style={paint('ocean-ray')} />
          <path d="M74 0 L 84 0 L 94 100 L 80 100 Z" style={paint('ocean-ray')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow" style={at({ left: '10%', top: '40%', width: '5rem' })} viewBox="0 0 80 30">
          <Fish x={0} y={4} size={0.5} token="ocean-fish-faint" />
          <Fish x={40} y={16} size={0.4} token="ocean-fish-faint" />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    const bubbles = [
      { left: '14%', top: '62%', size: '0.9rem', loop: 'scene-loop--rise' },
      { left: '20%', top: '70%', size: '0.6rem', loop: 'scene-loop--rise-slow' },
      { left: '78%', top: '30%', size: '0.8rem', loop: 'scene-loop--rise' },
      { left: '86%', top: '40%', size: '0.55rem', loop: 'scene-loop--rise-slow' },
      { left: '64%', top: '78%', size: '0.7rem', loop: 'scene-loop--rise' },
    ];
    return (
      <>
        {bubbles.map((b) => (
          <svg key={`${b.left}${b.top}`} className={`scene-art scene-loop ${b.loop}`} style={at({ left: b.left, top: b.top, width: b.size })} viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" style={ink('ocean-bubble', 2)} />
          </svg>
        ))}
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '6%', top: '26%', width: '4.5rem' })} viewBox="0 0 60 30">
          <Fish x={2} y={2} size={1} token="ocean-fish-orange" />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '6%', top: '56%', width: '3.2rem' })} viewBox="0 0 60 30">
          <Fish x={2} y={2} size={1} token="ocean-fish-teal" flip />
        </svg>
        <svg className="scene-art scene-loop scene-loop--bob" style={at({ right: '14%', top: '16%', width: '3rem' })} viewBox="0 0 40 50">
          {/* A jellyfish: a dome and four wavy tentacles. */}
          <path d="M4 22 C 4 6 36 6 36 22 Z" style={paint('ocean-jelly')} />
          <path d="M10 22 q 3 6 0 12 q -3 6 0 12 M17 22 q 3 6 0 12 q -3 6 0 10 M24 22 q 3 6 0 12 q -3 6 0 10 M31 22 q 3 6 0 12 q -3 6 0 12" style={ink('ocean-jelly', 2)} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-30%', top: '34%', width: '14rem' })} viewBox="0 0 60 30">
        <Fish x={2} y={2} size={1} token="ocean-shadow" />
      </svg>
      {/* The sea floor at the finish end: wider than the screen and well past its bottom. */}
      <svg className="scene-art" style={at({ left: '-10%', bottom: '-5rem', width: '120%', height: '13rem' })} viewBox="0 0 400 130" preserveAspectRatio="none">
        <path d="M0 40 C 60 22 120 30 190 38 C 260 46 330 24 400 34 L 400 130 L 0 130 Z" style={paint('ocean-sand-shade')} />
        <path d="M0 56 C 80 40 160 50 230 56 C 300 62 350 46 400 52 L 400 130 L 0 130 Z" style={paint('ocean-sand')} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway" style={at({ left: '6%', bottom: '4.5rem', width: '2.4rem', height: '7rem' })} viewBox="0 0 24 70" preserveAspectRatio="none">
        <path d="M12 70 C 2 56 20 44 10 30 C 2 18 16 8 12 0 L 16 2 C 20 12 8 20 16 32 C 24 46 8 56 18 70 Z" style={paint('ocean-weed')} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway-back" style={at({ right: '8%', bottom: '4rem', width: '2rem', height: '5.5rem' })} viewBox="0 0 24 70" preserveAspectRatio="none">
        <path d="M12 70 C 2 56 20 44 10 30 C 2 18 16 8 12 0 L 16 2 C 20 12 8 20 16 32 C 24 46 8 56 18 70 Z" style={paint('ocean-weed')} />
      </svg>
      <svg className="scene-art" style={at({ left: '60%', bottom: '4.2rem', width: '4.5rem' })} viewBox="0 0 60 44">
        {/* A treasure chest: brown body, a lighter domed lid, a gold clasp. */}
        <rect x="4" y="18" width="52" height="24" rx="3" style={paint('ocean-chest')} />
        <path d="M4 20 C 4 6 56 6 56 20 Z" style={paint('ocean-chest-lid')} />
        <rect x="26" y="16" width="8" height="10" rx="2" style={paint('ocean-clasp')} />
      </svg>
    </>
  );
}

/** A simple fish facing right (or left with `flip`), about 56 × 26 at size 1. */
function Fish({ x, y, size, token, flip = false }: { x: number; y: number; size: number; token: string; flip?: boolean }) {
  const turn = flip ? ` translate(56 0) scale(-1 1)` : '';
  return (
    <g transform={`translate(${x} ${y}) scale(${size})${turn}`}>
      <ellipse cx="32" cy="13" rx="22" ry="11" style={paint(token)} />
      <path d="M12 13 L 0 2 L 0 24 Z" style={paint(token)} />
    </g>
  );
}
