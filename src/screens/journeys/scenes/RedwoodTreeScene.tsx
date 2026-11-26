import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';

/**
 * Redwood Tree (8 steps, climbing UP the trunk): a forest-morning sky, pale
 * green-blue at the bottom to light blue at the top. Far: misty hills with
 * distant tree shapes and a few tiny birds. Mid: the tall rust-brown trunk
 * behind the track with bark ridges and branch stubs, a small bird on a branch,
 * two leaves drifting down, and the dark canopy at the finish (top) end. Near:
 * big needle clusters from both edges, ferns and the forest floor at the start
 * (bottom) end, past the edges. Loops (Full decor only): 8.
 */
export default function RedwoodTreeScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('redwood-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('redwood-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('redwood-sky-low')} />
        </svg>
        <svg className="scene-art scene-art--faint" style={at({ left: '-10%', bottom: '0', width: '120%', height: '40%' })} viewBox="0 0 400 160" preserveAspectRatio="none">
          {/* Misty hills with distant tree shapes. */}
          <path d="M0 70 L 30 40 L 44 60 L 70 24 L 92 58 L 130 30 L 160 62 L 200 36 L 236 64 L 270 28 L 300 60 L 340 34 L 372 62 L 400 44 L 400 160 L 0 160 Z" style={paint('redwood-hill-far')} />
          <path d="M0 108 C 60 84 120 92 180 104 C 250 118 320 86 400 98 L 400 160 L 0 160 Z" style={paint('redwood-hill-near')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow" style={at({ left: '10%', top: '14%', width: '3.5rem' })} viewBox="0 0 60 24">
          <path d="M2 10 q 5 -6 10 0 q 5 -6 10 0 M30 4 q 4 -5 8 0 q 4 -5 8 0 M44 16 q 3 -4 6 0 q 3 -4 6 0" style={ink('redwood-bird', 1.6)} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        {/* The trunk behind the track, the canopy on top at the finish end. */}
        <svg className="scene-art" style={at({ left: 'calc(50% - 5rem)', top: '12rem', width: '10rem', height: 'calc(100% - 12rem)' })} viewBox="0 0 100 1000" preserveAspectRatio="none">
          <path d="M18 0 L 82 0 L 88 1000 L 12 1000 Z" style={paint('redwood-trunk')} />
          <path d="M30 0 L 28 1000 M48 0 L 50 1000 M66 0 L 70 1000 M38 0 L 36 1000 M58 0 L 60 1000" style={ink('redwood-bark', 3)} />
        </svg>
        <svg className="scene-art" style={at({ left: 'calc(50% - 9.5rem)', top: '34%', width: '6.5rem' })} viewBox="0 0 80 40">
          <path d="M80 26 L 30 20 L 30 26 Z" style={paint('redwood-trunk')} />
          <ellipse cx="22" cy="18" rx="20" ry="11" style={paint('redwood-needles')} />
          <ellipse cx="36" cy="12" rx="12" ry="8" style={paint('redwood-needles-light')} />
        </svg>
        <svg className="scene-art" style={at({ left: 'calc(50% + 3rem)', top: '58%', width: '6.5rem' })} viewBox="0 0 80 40">
          <path d="M0 26 L 50 20 L 50 26 Z" style={paint('redwood-trunk')} />
          <ellipse cx="58" cy="18" rx="20" ry="11" style={paint('redwood-needles')} />
          <ellipse cx="44" cy="12" rx="12" ry="8" style={paint('redwood-needles-light')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--bob" style={at({ left: 'calc(50% - 8.1rem)', top: 'calc(34% - 0.9rem)', width: '1.4rem' })} viewBox="0 0 24 20">
          {/* A small bird on the branch. */}
          <ellipse cx="11" cy="12" rx="8" ry="6" style={paint('redwood-robin')} />
          <circle cx="17" cy="7" r="4" style={paint('redwood-robin')} />
          <path d="M20 7 L 24 8 L 20 9 Z" style={paint('redwood-beak')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--fall" style={at({ left: '16%', top: '22%', width: '1.1rem' })} viewBox="0 0 20 12">
          <ellipse cx="10" cy="6" rx="9" ry="4" style={paint('redwood-leaf')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--fall-slow" style={at({ right: '18%', top: '44%', width: '1rem' })} viewBox="0 0 20 12">
          <ellipse cx="10" cy="6" rx="9" ry="4" style={paint('redwood-leaf')} />
        </svg>
        <svg className="scene-art" style={at({ left: '-6%', top: '0', width: '112%', height: '16rem' })} viewBox="0 0 400 160" preserveAspectRatio="none">
          {/* The canopy at the finish end. */}
          <ellipse cx="200" cy="70" rx="190" ry="70" style={paint('redwood-canopy')} />
          <ellipse cx="90" cy="96" rx="90" ry="44" style={paint('redwood-canopy')} />
          <ellipse cx="310" cy="96" rx="90" ry="44" style={paint('redwood-canopy')} />
          <ellipse cx="200" cy="120" rx="110" ry="34" style={paint('redwood-needles')} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--sway" style={at({ left: '-10%', top: '18%', width: '9rem' })} viewBox="0 0 120 90">
        <Needles />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway-back" style={at({ right: '-10%', top: '52%', width: '10rem' })} viewBox="0 0 120 90">
        <g transform="translate(120 0) scale(-1 1)">
          <Needles />
        </g>
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway" style={at({ left: '-4%', bottom: '3.5rem', width: '8rem' })} viewBox="0 0 100 60">
        <Fern />
      </svg>
      <svg className="scene-art scene-loop scene-loop--sway-back" style={at({ right: '-4%', bottom: '3rem', width: '7rem' })} viewBox="0 0 100 60">
        <g transform="translate(100 0) scale(-1 1)">
          <Fern />
        </g>
      </svg>
      {/* The forest floor at the start end, past the screen's edges and bottom. */}
      <svg className="scene-art" style={at({ left: '-10%', bottom: '-4rem', width: '120%', height: '10rem' })} viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 34 C 80 18 160 30 230 26 C 300 22 350 34 400 28 L 400 100 L 0 100 Z" style={paint('redwood-floor-shade')} />
        <path d="M0 48 C 90 36 170 46 240 42 C 310 38 360 50 400 44 L 400 100 L 0 100 Z" style={paint('redwood-floor')} />
      </svg>
    </>
  );
}

/** A big cluster of redwood needles reaching in from the left edge. */
function Needles() {
  return (
    <>
      <path d="M0 40 L 120 46" style={ink('redwood-trunk', 4)} />
      <ellipse cx="40" cy="38" rx="40" ry="22" style={paint('redwood-needles')} />
      <ellipse cx="78" cy="48" rx="34" ry="18" style={paint('redwood-canopy')} />
      <ellipse cx="60" cy="28" rx="26" ry="14" style={paint('redwood-needles-light')} />
    </>
  );
}

/** A fern: a curved stem with leaflets. */
function Fern() {
  return (
    <>
      <path d="M10 60 C 30 40 60 22 96 14" style={ink('redwood-fern', 3)} />
      <path d="M24 48 l -6 -12 M36 40 l -4 -14 M50 32 l -2 -14 M64 26 l 0 -12 M78 20 l 2 -10 M30 44 l 10 8 M44 36 l 12 8 M58 30 l 12 6 M72 24 l 12 4" style={ink('redwood-fern', 3)} />
    </>
  );
}
