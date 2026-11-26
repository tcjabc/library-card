import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';
import { Cloud } from './parts';

/**
 * Ocean Cliff (10 steps, climbing UP a cliff from the sea): a warm light-blue
 * sky brightening towards the top, the sea at the very bottom. Far: faint
 * clouds and a tiny sailboat on the horizon. Mid: the layered rock face behind
 * the track with ledges and grass tufts, two gulls gliding, and a lighthouse at
 * the finish (top) end whose lamp glimmers. Near: waves with foam at the start
 * (bottom) end, a rock outcrop on the left edge, rising spray and a big cloud
 * passing. Loops (Full decor only): 9.
 */
export default function OceanCliffScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('cliff-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('cliff-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('cliff-sky-low')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow scene-art--faint" style={at({ left: '8%', top: '16%', width: '60%' })} viewBox="0 0 300 70">
          <Cloud x={10} y={18} scale={0.6} />
          <Cloud x={170} y={6} scale={0.5} />
        </svg>
        {/* The sea at the very bottom, and a tiny sailboat on the horizon. */}
        <svg className="scene-art" style={at({ left: '0', bottom: '0', width: '100%', height: '16%' })} viewBox="0 0 100 40" preserveAspectRatio="none">
          <rect width="100" height="40" style={paint('cliff-sea-far')} />
          <rect width="100" height="2" style={paint('cliff-horizon')} />
        </svg>
        <svg className="scene-art" style={at({ right: '18%', bottom: 'calc(16% - 0.2rem)', width: '1.6rem' })} viewBox="0 0 20 22">
          <path d="M10 2 L 10 16 L 2 16 Z" style={paint('cliff-sail')} />
          <path d="M12 6 L 12 16 L 18 16 Z" style={paint('cliff-sail')} />
          <path d="M2 17 L 18 17 L 15 21 L 5 21 Z" style={paint('cliff-boat')} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        {/* The rock face behind the track, its top at the finish end. */}
        <svg className="scene-art" style={at({ left: '-4%', top: '17rem', width: '72%', height: 'calc(100% - 17rem)' })} viewBox="0 0 300 1000" preserveAspectRatio="none">
          <path d="M0 20 L 120 0 L 180 30 L 220 90 L 250 200 L 230 320 L 270 460 L 250 600 L 290 760 L 270 1000 L 0 1000 Z" style={paint('cliff-rock')} />
          <path d="M0 140 L 230 160 M0 300 L 240 320 M0 480 L 262 470 M0 640 L 260 650 M0 820 L 282 830" style={ink('cliff-ledge', 6)} />
          <path d="M60 136 q 6 -20 12 0 q 6 -16 12 0 M150 296 q 6 -20 12 0 q 6 -16 12 0 M90 476 q 6 -20 12 0 q 6 -16 12 0 M190 816 q 6 -20 12 0 q 6 -16 12 0" style={paint('cliff-grass')} />
        </svg>
        <svg className="scene-art" style={at({ left: '22%', top: '11rem', width: '2.6rem' })} viewBox="0 0 30 72">
          {/* The lighthouse: white tower, a red band, the lamp room. */}
          <path d="M8 72 L 11 20 L 19 20 L 22 72 Z" style={paint('cliff-lighthouse')} />
          <path d="M9.4 46 L 20.6 46 L 21 54 L 9 54 Z" style={paint('cliff-lighthouse-band')} />
          <rect x="9" y="10" width="12" height="10" rx="1" style={paint('cliff-lighthouse-room')} />
          <path d="M8 10 L 15 2 L 22 10 Z" style={paint('cliff-lighthouse-band')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--glimmer" style={at({ left: '22%', top: '11rem', width: '2.6rem' })} viewBox="0 0 30 72">
          <circle cx="15" cy="15" r="4" style={paint('cliff-lamp')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '58%', top: '22%', width: '2.4rem' })} viewBox="0 0 40 16">
          <Gull />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '6%', top: '40%', width: '2rem' })} viewBox="0 0 40 16">
          <Gull />
        </svg>
      </>
    );
  }
  const spray = [
    { left: '18%', bottom: '5rem', size: '0.5rem', loop: 'scene-loop--rise' },
    { left: '46%', bottom: '4.5rem', size: '0.4rem', loop: 'scene-loop--rise-slow' },
    { left: '76%', bottom: '5.5rem', size: '0.55rem', loop: 'scene-loop--rise' },
  ];
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-30%', top: '30%', width: '14rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} />
      </svg>
      <svg className="scene-art" style={at({ left: '-12%', bottom: '3rem', width: '9rem' })} viewBox="0 0 100 80">
        <path d="M0 80 L 0 30 L 30 10 L 64 20 L 86 50 L 100 80 Z" style={paint('cliff-rock-near')} />
        <path d="M10 40 L 50 30 M20 60 L 76 56" style={ink('cliff-ledge', 3)} />
      </svg>
      {spray.map((s) => (
        <svg key={s.left} className={`scene-art scene-loop ${s.loop}`} style={at({ left: s.left, bottom: s.bottom, width: s.size })} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" style={paint('cliff-foam')} />
        </svg>
      ))}
      {/* Waves with foam at the start end, past the screen's edges and bottom. */}
      <svg className="scene-art scene-loop scene-loop--bob-slow" style={at({ left: '-10%', bottom: '-3rem', width: '120%', height: '8.5rem' })} viewBox="0 0 400 90" preserveAspectRatio="none">
        <path d="M0 26 Q 25 14 50 26 T 100 26 T 150 26 T 200 26 T 250 26 T 300 26 T 350 26 T 400 26 L 400 90 L 0 90 Z" style={paint('cliff-sea')} />
        <path d="M0 26 Q 25 14 50 26 T 100 26 T 150 26 T 200 26 T 250 26 T 300 26 T 350 26 T 400 26" style={ink('cliff-foam', 4)} />
        <path d="M0 50 Q 30 42 60 50 T 120 50 T 180 50 T 240 50 T 300 50 T 360 50 T 420 50" style={ink('cliff-foam', 2)} />
      </svg>
    </>
  );
}

/** A gull gliding: two curved wings. */
function Gull() {
  return <path d="M2 10 Q 10 0 20 8 Q 30 0 38 10" style={ink('cliff-gull', 2.4)} />;
}
