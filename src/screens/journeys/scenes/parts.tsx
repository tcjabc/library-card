import { paint } from './art';

/**
 * A soft flat cloud, about 110 × 36 at scale 1, in a cloud colour with a lighter shade underneath
 * (shared by the sky scenes). `token` picks the colour pair: `cloud` / `cloud-shade` by default,
 * e.g. `ladder-cloud` / `ladder-cloud-shade` for night clouds.
 */
export function Cloud({ x, y, scale, token = 'cloud' }: { x: number; y: number; scale: number; token?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="55" cy="30" rx="52" ry="10" style={paint(`${token}-shade`)} />
      <circle cx="30" cy="22" r="14" style={paint(token)} />
      <circle cx="54" cy="16" r="18" style={paint(token)} />
      <circle cx="80" cy="22" r="14" style={paint(token)} />
      <rect x="16" y="22" width="78" height="12" rx="6" style={paint(token)} />
    </g>
  );
}

/** A four-pointed star sparkle in a 20 × 20 box, in a token's colour (the night scenes). */
export function Sparkle({ token }: { token: string }) {
  return <path d="M10 0 Q 11.5 8.5 20 10 Q 11.5 11.5 10 20 Q 8.5 11.5 0 10 Q 8.5 8.5 10 0 Z" style={paint(token)} />;
}
