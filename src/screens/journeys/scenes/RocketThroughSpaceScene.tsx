import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';
import { Sparkle } from './parts';

/** Small stars in the dark part of the far sky (x, y in a 100 × 300 box; size 1 or 2). */
const STARS: readonly (readonly [number, number, number])[] = [
  [6, 10, 1], [18, 26, 2], [30, 8, 1], [44, 20, 1], [58, 6, 2], [72, 28, 1], [86, 14, 1], [96, 34, 1],
  [10, 48, 1], [26, 62, 1], [40, 44, 2], [54, 58, 1], [68, 46, 1], [82, 64, 2], [92, 52, 1],
  [4, 92, 2], [20, 104, 1], [36, 86, 1], [50, 110, 1], [64, 94, 2], [78, 112, 1], [94, 90, 1],
  [12, 140, 1], [28, 156, 2], [46, 136, 1], [62, 160, 1], [80, 142, 1], [90, 166, 1],
];

/**
 * Rocket Through Space (30 steps, climbing UP): from the atmosphere into space,
 * pale blue at the bottom into deep navy and violet at the top. Far: small
 * stars, three twinkling, a faint nebula, and a small ringed planet at the
 * finish (top) end. Mid: the rocket at the finish end, bobbing, its flame
 * flickering, two satellites drifting and a star cluster. Near: fast streaks,
 * two asteroids drifting in from the edges, and the big curve of the planet
 * with its horizon glow at the start (bottom) end, past the edges. Loops (Full
 * decor only): 11.
 */
export default function RocketThroughSpaceScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="75" style={paint('rocket-sky-high')} />
          <rect y="75" width="100" height="75" style={paint('rocket-sky-mid')} />
          <rect y="150" width="100" height="75" style={paint('rocket-sky-edge')} />
          <rect y="225" width="100" height="75" style={paint('rocket-sky-low')} />
          {STARS.map(([x, y, size]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={size === 2 ? 0.55 : 0.32} style={paint('rocket-star')} />
          ))}
        </svg>
        <svg className="scene-art" style={at({ left: '-10%', top: '18%', width: '80%', height: '20%' })} viewBox="0 0 200 80" preserveAspectRatio="none">
          {/* A faint nebula: two soft overlapping blobs. */}
          <ellipse cx="80" cy="40" rx="70" ry="28" style={paint('rocket-nebula-a')} />
          <ellipse cx="120" cy="34" rx="56" ry="24" style={paint('rocket-nebula-b')} />
        </svg>
        {[
          { left: '20%', top: '12%', loop: 'scene-loop--glimmer' },
          { left: '78%', top: '30%', loop: 'scene-loop--glimmer-slow' },
          { left: '40%', top: '50%', loop: 'scene-loop--glimmer' },
        ].map((star) => (
          <svg key={star.left} className={`scene-art scene-loop ${star.loop}`} style={at({ left: star.left, top: star.top, width: '0.8rem' })} viewBox="0 0 20 20">
            <Sparkle token="rocket-star" />
          </svg>
        ))}
        <svg className="scene-art" style={at({ left: '10%', top: '12rem', width: '4.4rem' })} viewBox="0 0 60 36">
          {/* A small ringed planet at the finish end. */}
          <circle cx="30" cy="18" r="12" style={paint('rocket-ringed')} />
          <ellipse cx="30" cy="20" rx="27" ry="6" style={ink('rocket-ring', 2.4)} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        <div className="scene-art scene-loop scene-loop--bob" style={at({ right: '8%', top: '12rem', width: '3.6rem' })}>
          {/* The rocket: white body, red nose and fins, a round blue window, and its flame in its own box so the flicker moves a whole element. */}
          <svg className="scene-art scene-loop scene-loop--flicker" style={at({ left: '0', top: 'calc(100% - 0.4rem)', width: '100%' })} viewBox="0 70 40 22">
            <path d="M14 70 Q 20 92 26 70 Z" style={paint('rocket-flame')} />
            <path d="M16 70 Q 20 84 24 70 Z" style={paint('rocket-flame-core')} />
          </svg>
          <svg className="scene-rocket" viewBox="0 0 40 72">
            <path d="M20 0 C 30 12 32 30 30 70 L 10 70 C 8 30 10 12 20 0 Z" style={paint('rocket-body')} />
            <path d="M20 0 C 26 7 28 14 29 20 L 11 20 C 12 14 14 7 20 0 Z" style={paint('rocket-red')} />
            <path d="M10 50 L 0 72 L 10 66 Z M30 50 L 40 72 L 30 66 Z" style={paint('rocket-red')} />
            <circle cx="20" cy="36" r="6" style={paint('rocket-window')} />
            <circle cx="20" cy="36" r="6" style={ink('rocket-red', 1.6)} />
          </svg>
        </div>
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '6%', top: '30%', width: '3rem' })} viewBox="0 0 48 20">
          <Satellite />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '10%', top: '58%', width: '2.6rem' })} viewBox="0 0 48 20">
          <Satellite />
        </svg>
        <svg className="scene-art" style={at({ left: '14%', top: '46%', width: '2.6rem' })} viewBox="0 0 30 20">
          {/* A small star cluster. */}
          <circle cx="6" cy="6" r="1.6" style={paint('rocket-star')} />
          <circle cx="14" cy="4" r="1.2" style={paint('rocket-star')} />
          <circle cx="20" cy="10" r="1.8" style={paint('rocket-star')} />
          <circle cx="10" cy="14" r="1.2" style={paint('rocket-star')} />
          <circle cx="26" cy="16" r="1.2" style={paint('rocket-star')} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-30%', top: '20%', width: '12rem' })} viewBox="0 0 120 20">
        <path d="M0 10 L 120 4 M10 18 L 90 14" style={ink('rocket-streak', 1.6)} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-30%', top: '62%', width: '10rem' })} viewBox="0 0 120 20">
        <path d="M0 8 L 110 14" style={ink('rocket-streak', 1.6)} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '-6%', top: '40%', width: '3.4rem' })} viewBox="0 0 40 32">
        <Asteroid />
      </svg>
      <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '-5%', top: '74%', width: '2.6rem' })} viewBox="0 0 40 32">
        <Asteroid />
      </svg>
      {/* The planet's big curve and its horizon glow at the start end, past the edges; tall enough to clear a browser toolbar over the bottom. */}
      <svg className="scene-art" style={at({ left: '-25%', bottom: '0', width: '150%', height: 'max(14rem, 20vh)' })} viewBox="0 0 400 120" preserveAspectRatio="none">
        <ellipse cx="200" cy="160" rx="306" ry="136" style={paint('rocket-glow')} />
        <ellipse cx="200" cy="164" rx="300" ry="130" style={paint('rocket-planet')} />
        <path d="M70 70 C 130 56 210 64 290 54 M40 96 C 120 84 220 92 350 80" style={ink('rocket-planet-band', 6)} />
      </svg>
    </>
  );
}

/** A small satellite: a body and two solar panels. */
function Satellite() {
  return (
    <>
      <rect x="0" y="6" width="16" height="8" style={paint('rocket-panel')} />
      <rect x="32" y="6" width="16" height="8" style={paint('rocket-panel')} />
      <rect x="18" y="3" width="12" height="14" rx="2" style={paint('rocket-satellite')} />
    </>
  );
}

/** A lumpy grey-brown asteroid with two craters. */
function Asteroid() {
  return (
    <>
      <path d="M6 10 Q 14 0 26 4 Q 38 8 36 20 Q 32 32 18 30 Q 2 28 6 10 Z" style={paint('rocket-asteroid')} />
      <circle cx="16" cy="14" r="3.5" style={paint('rocket-asteroid-dark')} />
      <circle cx="26" cy="22" r="2.5" style={paint('rocket-asteroid-dark')} />
    </>
  );
}
