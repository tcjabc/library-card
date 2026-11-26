import type { SceneLayer } from '../../../journeys/scene';
import { at, ink, paint } from './art';

/**
 * Hot-Air Balloon (20 steps, rising): a sky in three bands, pale at the bottom
 * to deeper blue at the top. Far: small faint clouds and a tiny distant
 * balloon. Mid: the finish balloon at the top end of the track, bobbing, and two
 * clouds drifting. Near: two big clouds and green hills at the start (bottom)
 * end, wider than the screen, with a tiny tree. Loops (Full decor only): 7.
 */
export default function HotAirBalloonScene({ layer }: { layer: SceneLayer }) {
  if (layer === 'far') {
    return (
      <>
        <svg className="scene-fill" viewBox="0 0 100 300" preserveAspectRatio="none">
          <rect width="100" height="100" style={paint('balloon-sky-high')} />
          <rect y="100" width="100" height="100" style={paint('balloon-sky-mid')} />
          <rect y="200" width="100" height="100" style={paint('balloon-sky-low')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-slow scene-art--faint" style={at({ left: '6%', top: '14%', width: '62%' })} viewBox="0 0 300 70">
          <Cloud x={10} y={20} scale={0.6} />
          <Cloud x={150} y={6} scale={0.45} />
          <Cloud x={230} y={40} scale={0.5} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--bob-slow" style={at({ right: '12%', top: '34%', width: '1.6rem' })} viewBox="0 0 20 28">
          <ellipse cx="10" cy="9" rx="8" ry="9" style={paint('balloon-far')} />
          <rect x="7.5" y="20" width="5" height="4" rx="1" style={paint('balloon-basket')} />
        </svg>
      </>
    );
  }
  if (layer === 'mid') {
    return (
      <>
        <svg className="scene-art scene-loop scene-loop--bob" style={at({ right: '5%', top: '15rem', width: '6.5rem' })} viewBox="0 0 100 140">
          {/* The finish balloon: envelope with a yellow band and a red centre stripe, two ropes, a basket. */}
          <path d="M50 4 C 18 4 4 28 4 50 C 4 74 30 92 42 104 L 58 104 C 70 92 96 74 96 50 C 96 28 82 4 50 4 Z" style={paint('balloon-red')} />
          <path d="M8 60 C 30 66 70 66 92 60 L 90 70 C 68 76 32 76 10 70 Z" style={paint('balloon-yellow')} />
          <path d="M44 6 C 38 40 38 80 44 104 L 56 104 C 62 80 62 40 56 6 Z" style={paint('balloon-stripe')} />
          <path d="M42 104 L 40 120 M58 104 L 60 120" style={ink('balloon-rope', 2)} />
          <rect x="36" y="118" width="28" height="18" rx="3" style={paint('balloon-basket')} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift" style={at({ left: '3%', top: '24%', width: '8rem' })} viewBox="0 0 120 50">
          <Cloud x={6} y={8} scale={1} />
        </svg>
        <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ right: '4%', top: '46%', width: '8.5rem' })} viewBox="0 0 120 50">
          <Cloud x={6} y={8} scale={1} />
        </svg>
      </>
    );
  }
  return (
    <>
      <svg className="scene-art scene-loop scene-loop--drift-back" style={at({ left: '-12%', top: '16%', width: '15rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} />
      </svg>
      <svg className="scene-art scene-loop scene-loop--drift" style={at({ right: '-14%', top: '52%', width: '16rem' })} viewBox="0 0 120 50">
        <Cloud x={6} y={8} scale={1} />
      </svg>
      {/* Rolling hills at the start end, wider than the screen and past its bottom. */}
      <svg className="scene-art" style={at({ left: '-15%', bottom: '-3rem', width: '130%', height: '14rem' })} viewBox="0 0 400 140" preserveAspectRatio="none">
        <path d="M0 70 C 70 30 140 30 210 62 C 270 88 330 40 400 52 L 400 140 L 0 140 Z" style={paint('balloon-hill-back')} />
        <path d="M0 96 C 90 60 170 74 240 92 C 300 108 350 80 400 88 L 400 140 L 0 140 Z" style={paint('balloon-hill-front')} />
      </svg>
      <svg className="scene-art" style={at({ left: '22%', bottom: '6.2rem', width: '1.8rem' })} viewBox="0 0 20 30">
        <rect x="8.5" y="18" width="3" height="12" style={paint('balloon-trunk')} />
        <circle cx="10" cy="12" r="9" style={paint('balloon-tree')} />
      </svg>
    </>
  );
}

/** A soft flat cloud, about 110 × 36 at scale 1, in the cloud colour with a lighter shade underneath. */
function Cloud({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="55" cy="30" rx="52" ry="10" style={paint('cloud-shade')} />
      <circle cx="30" cy="22" r="14" style={paint('cloud')} />
      <circle cx="54" cy="16" r="18" style={paint('cloud')} />
      <circle cx="80" cy="22" r="14" style={paint('cloud')} />
      <rect x="16" y="22" width="78" height="12" rx="6" style={paint('cloud')} />
    </g>
  );
}
