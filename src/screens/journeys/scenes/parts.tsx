import { paint } from './art';

/** A soft flat cloud, about 110 × 36 at scale 1, in the cloud colour with a lighter shade underneath (shared by the sky scenes). */
export function Cloud({ x, y, scale }: { x: number; y: number; scale: number }) {
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
