import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';
import { Cloud } from './parts';

/**
 * Skyscraper (12 steps, climbing UP the tower): a city dawn, pale peach at the
 * bottom to blue at the top. Far: a distant skyline in two muted blue-greys and
 * a faint plane trail. Mid: the glass tower behind the track with its grid of
 * windows (some lit, three twinkling), the antenna with a blinking red light at
 * the finish (top) end, and a helicopter drifting. Near: neighbouring building
 * edges at both sides, a crane arm, the street with a tiny car at the start
 * (bottom) end, past the edges, and a small cloud passing. Loops (Full decor
 * only): 7.
 */
export default function SkyscraperScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('tower-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('tower-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('tower-sky-low')} />
        </svg>
        <svg className="scene-art scene-art--faint" style={at({ left: '-5%', bottom: '0', width: '110%', height: '34%' })} viewBox="0 0 400 140" preserveAspectRatio="none">
          {/* A distant skyline in two greys. */}
          <path d="M0 60 L 30 60 L 30 30 L 56 30 L 56 70 L 90 70 L 90 20 L 112 20 L 112 50 L 150 50 L 150 36 L 180 36 L 180 64 L 220 64 L 220 14 L 244 14 L 244 56 L 290 56 L 290 40 L 320 40 L 320 70 L 360 70 L 360 28 L 400 28 L 400 140 L 0 140 Z" style={paint('tower-skyline-far')} />
          <path d="M0 96 L 40 96 L 40 72 L 70 72 L 70 100 L 120 100 L 120 80 L 160 80 L 160 104 L 210 104 L 210 76 L 250 76 L 250 98 L 300 98 L 300 84 L 340 84 L 340 106 L 400 106 L 400 140 L 0 140 Z" style={paint('tower-skyline-near')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow scene-art--faint" style={at({ left: '6%', top: '12%', width: '55%' })} viewBox="0 0 200 20">
          <path d="M0 16 L 170 6" style={ink('tower-trail', 2)} />
          <path d="M170 6 L 186 3 L 182 8 Z" style={paint('tower-trail')} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        {/* The tower behind the track: glass, a grid of windows, a few lit. */}
        <svg className="scene-art" style={at({ left: 'calc(50% - 5.5rem)', top: '16rem', width: '11rem', height: 'calc(100% - 16rem)' })} viewBox="0 0 110 1000" preserveAspectRatio="none">
          <defs>
            <pattern id="tower-windows" width="22" height="30" patternUnits="userSpaceOnUse">
              <rect x="4" y="5" width="14" height="20" rx="1" style={paint('tower-window')} />
            </pattern>
          </defs>
          <rect width="110" height="1000" style={paint('tower-glass')} />
          <rect width="110" height="1000" style={{ fill: 'url(#tower-windows)' }} />
          <rect x="26" y="125" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect x="70" y="245" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect x="4" y="425" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect x="48" y="605" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect className="scene-loop scene-loop--glimmer" x="92" y="185" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect className="scene-loop scene-loop--glimmer-slow" x="26" y="335" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
          <rect className="scene-loop scene-loop--glimmer" x="70" y="515" width="14" height="20" rx="1" style={paint('tower-window-lit')} />
        </svg>
        <svg className="scene-art" style={at({ left: 'calc(50% - 1.5rem)', top: '9rem', width: '3rem', height: '7rem' })} viewBox="0 0 30 70">
          {/* The antenna on top, at the finish end. */}
          <rect x="6" y="56" width="18" height="14" style={paint('tower-glass')} />
          <path d="M15 8 L 15 56" style={ink('tower-antenna', 3)} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--blink" style={at({ left: 'calc(50% - 1.5rem)', top: '9rem', width: '3rem', height: '7rem' })} viewBox="0 0 30 70">
          <circle cx="15" cy="7" r="4" style={paint('tower-beacon')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '8%', top: '30%', width: '3rem' })} viewBox="0 0 48 26">
          {/* A small helicopter. */}
          <ellipse cx="22" cy="15" rx="12" ry="8" style={paint('tower-heli')} />
          <path d="M34 14 L 46 12" style={ink('tower-heli', 3)} />
          <path d="M6 5 L 38 5 M22 5 L 22 8 M14 24 L 30 24" style={ink('tower-antenna', 2)} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--pass" style={at({ left: '-20%', top: '40%', width: '7rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} />
      </svg>
      {/* Neighbouring buildings at both edges. */}
      <svg className="scene-art" style={at({ left: '-6%', top: '20%', width: '5rem', height: '80%' })} viewBox="0 0 50 800" preserveAspectRatio="none">
        <rect width="50" height="800" style={paint('tower-neighbour')} />
        <path d="M30 0 L 30 800 M40 0 L 40 800" style={ink('tower-neighbour-line', 2)} />
      </svg>
      <svg className="scene-art" style={at({ right: '-6%', top: '34%', width: '5.5rem', height: '66%' })} viewBox="0 0 50 800" preserveAspectRatio="none">
        <rect width="50" height="800" style={paint('tower-neighbour')} />
        <path d="M10 0 L 10 800 M20 0 L 20 800" style={ink('tower-neighbour-line', 2)} />
      </svg>
      <svg className="scene-art" style={at({ right: '-4%', top: '26%', width: '11rem' })} viewBox="0 0 120 60">
        {/* A crane arm with its hook. */}
        <path d="M0 10 L 120 10 L 120 18 L 0 18 Z" style={paint('tower-crane')} />
        <path d="M8 10 L 20 18 L 32 10 L 44 18 L 56 10 L 68 18 L 80 10 L 92 18 L 104 10 L 116 18" style={ink('tower-crane-line', 1.6)} />
        <path d="M30 18 L 30 46" style={ink('tower-antenna', 1.4)} />
        <path d="M26 46 L 34 46 L 34 52 Q 30 56 26 52" style={ink('tower-crane-line', 2)} />
      </svg>
      {/* The street at the start end, past the screen's edges and bottom, and a tiny car. */}
      <svg className="scene-art" style={at({ left: '-10%', bottom: '-3rem', width: '120%', height: '7.5rem' })} viewBox="0 0 400 75" preserveAspectRatio="none">
        <rect width="400" height="10" style={paint('tower-pavement')} />
        <rect y="10" width="400" height="65" style={paint('tower-street')} />
        <path d="M0 34 L 400 34" style={{ ...ink('tower-street-line', 3), strokeDasharray: '16 12' }} />
      </svg>
      <svg className="scene-art" style={at({ left: '24%', bottom: '2.6rem', width: '2.6rem' })} viewBox="0 0 40 20">
        <path d="M4 12 L 8 5 L 28 5 L 34 12 L 38 12 L 38 17 L 2 17 L 2 12 Z" style={paint('tower-car')} />
        <circle cx="10" cy="17" r="3" style={paint('tower-street')} />
        <circle cx="30" cy="17" r="3" style={paint('tower-street')} />
      </svg>
    </>
  );
}
