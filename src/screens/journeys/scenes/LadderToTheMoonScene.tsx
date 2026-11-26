import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';
import { Cloud, Sparkle } from './parts';

/** The start-end hill's height: taller on tall screens, so it clears a browser toolbar over the bottom. */
const HILL = 'max(12rem, 18vh)';

/** Small stars across the far sky (x, y in a 100 × 300 box; size 1 or 2). */
const STARS: readonly (readonly [number, number, number])[] = [
  [8, 14, 1], [22, 30, 2], [37, 9, 1], [52, 24, 1], [68, 12, 2], [84, 32, 1], [93, 8, 1],
  [12, 58, 1], [30, 70, 1], [46, 52, 2], [62, 66, 1], [78, 54, 1], [90, 74, 2],
  [6, 102, 2], [20, 118, 1], [40, 96, 1], [56, 124, 1], [72, 104, 2], [88, 120, 1],
  [14, 150, 1], [34, 166, 2], [50, 146, 1], [66, 172, 1], [82, 152, 1], [96, 168, 1],
  [10, 200, 1], [26, 214, 1], [44, 196, 2], [60, 222, 1], [76, 204, 1], [92, 230, 1],
  [18, 250, 1], [38, 262, 1], [58, 248, 1], [74, 268, 2], [88, 254, 1],
];

/**
 * Ladder to the Moon (25 steps, climbing UP at night): night bands, deep indigo
 * at the bottom to a lighter blue-violet near the moon at the top (a soft
 * twilight in the light theme, deeper in dark). Far: small stars of two sizes,
 * four twinkling, the big pale moon with soft craters at the finish (top) end, a
 * faint distant planet. Mid: the long wooden ladder behind the track, two
 * shooting stars and an owl gliding. Near: wispy night clouds passing at the
 * edges, two big bright stars glimmering, and rooftops on a hill at the start
 * (bottom) end. Loops (Full decor only): 11.
 */
export default function LadderToTheMoonScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('ladder-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('ladder-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('ladder-sky-low')} />
          {STARS.map(([x, y, size]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={size === 2 ? 0.55 : 0.32} style={paint('ladder-star')} />
          ))}
        </svg>
        {[
          { left: '16%', top: '22%', loop: 'scene-loop--glimmer' },
          { left: '74%', top: '40%', loop: 'scene-loop--glimmer-slow' },
          { left: '30%', top: '62%', loop: 'scene-loop--glimmer-slow' },
          { left: '86%', top: '76%', loop: 'scene-loop--glimmer' },
        ].map((star) => (
          <svg key={star.left} className={`scene-art scene-loop ${star.loop}`} style={at({ left: star.left, top: star.top, width: '0.8rem' })} viewBox="0 0 20 20">
            <Sparkle token="ladder-star" />
          </svg>
        ))}
        <svg className="scene-art" style={at({ right: '8%', top: '11rem', width: '7.5rem' })} viewBox="0 0 60 60">
          {/* The moon with soft craters. */}
          <circle cx="30" cy="30" r="28" style={paint('ladder-moon-glow')} />
          <circle cx="30" cy="30" r="22" style={paint('ladder-moon')} />
          <circle cx="22" cy="24" r="4" style={paint('ladder-crater')} />
          <circle cx="36" cy="36" r="5" style={paint('ladder-crater')} />
          <circle cx="34" cy="20" r="2.5" style={paint('ladder-crater')} />
        </svg>
        <svg className="scene-art scene-art--faint" style={at({ left: '12%', top: '46%', width: '1.6rem' })} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" style={paint('ladder-planet')} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    const rungs = Array.from({ length: 24 }, (_, i) => 30 + i * 40);
    return (
      <>
        {/* The long wooden ladder behind the track, rising into the sky. */}
        <svg className="scene-art" style={at({ left: 'calc(50% - 3.6rem)', top: '14rem', width: '7.2rem', height: 'calc(100% - 14rem)' })} viewBox="0 0 72 1000" preserveAspectRatio="none">
          <rect x="4" width="7" height="1000" style={paint('ladder-wood')} />
          <rect x="61" width="7" height="1000" style={paint('ladder-wood')} />
          {rungs.map((y) => (
            <rect key={y} x="4" y={y} width="64" height="6" style={paint('ladder-rung')} />
          ))}
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '6%', top: '20%', width: '5rem' })} viewBox="0 0 80 30">
          <path d="M4 26 L 60 6" style={ink('ladder-streak', 2)} />
          <circle cx="62" cy="5" r="3" style={paint('ladder-star')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '8%', top: '52%', width: '4rem' })} viewBox="0 0 80 30">
          <path d="M4 26 L 60 6" style={ink('ladder-streak', 2)} />
          <circle cx="62" cy="5" r="3" style={paint('ladder-star')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow" style={at({ right: '18%', top: '34%', width: '3.2rem' })} viewBox="0 0 48 28">
          {/* An owl gliding: round head with ear tufts, a pale face, big eyes. */}
          <path d="M2 18 Q 12 6 24 14 Q 36 6 46 18 Q 36 16 24 22 Q 12 16 2 18 Z" style={paint('ladder-owl')} />
          <path d="M17 9 L 18 2 L 22 7 Z M31 9 L 30 2 L 26 7 Z" style={paint('ladder-owl')} />
          <circle cx="24" cy="13" r="8" style={paint('ladder-owl')} />
          <circle cx="20.5" cy="12" r="3.4" style={paint('ladder-owl-face')} />
          <circle cx="27.5" cy="12" r="3.4" style={paint('ladder-owl-face')} />
          <circle cx="20.5" cy="12" r="1.4" style={paint('ladder-hill')} />
          <circle cx="27.5" cy="12" r="1.4" style={paint('ladder-hill')} />
          <path d="M23 15 L 24 18 L 25 15 Z" style={paint('ladder-star-bright')} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-30%', top: '24%', width: '13rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} token="ladder-cloud" />
      </svg>
      <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '-14%', top: '58%', width: '11rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} token="ladder-cloud" />
      </svg>
      <svg className="scene-art scene-loop scene-loop--glimmer" style={at({ left: '4%', top: '42%', width: '1.6rem' })} viewBox="0 0 20 20">
        <Sparkle token="ladder-star-bright" />
      </svg>
      <svg className="scene-art scene-loop scene-loop--glimmer-slow" style={at({ right: '5%', top: '18%', width: '1.4rem' })} viewBox="0 0 20 20">
        <Sparkle token="ladder-star-bright" />
      </svg>
      {/* A hill at the start end, past the screen's edges, with rooftops and a few lit windows; tall enough to clear a browser toolbar over the bottom. */}
      <svg className="scene-art" style={at({ left: '-10%', bottom: '0', width: '120%', height: HILL })} viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 40 C 80 28 160 34 240 32 C 310 30 360 40 400 36 L 400 100 L 0 100 Z" style={paint('ladder-hill')} />
      </svg>
      <House left="6%" width="4.6rem" window />
      <House left="24%" width="3.2rem" />
      <House right="5%" width="5rem" window />
      <House right="24%" width="3.4rem" window />
    </>
  );
}

/** A house silhouette in the hill's colour, standing on the hill (a lit window or not). */
function House({ left, right, width, window: lit = false }: { left?: string; right?: string; width: string; window?: boolean }) {
  return (
    <svg className="scene-art" style={at({ left, right, bottom: `calc(${HILL} * 0.62)`, width })} viewBox="0 0 40 36">
      <path d="M0 36 L 0 16 L 20 2 L 40 16 L 40 36 Z M28 9 L 28 2 L 33 2 L 33 12 Z" style={paint('ladder-hill')} />
      {lit && <rect x="15" y="20" width="9" height="8" style={paint('ladder-window')} />}
    </svg>
  );
}
