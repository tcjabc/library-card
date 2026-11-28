/**
 * SVG path data for poster art (1.24.0): read any path (absolute or relative, every command), and
 * write it back in absolute M L H V C Q A Z only, the form the art test reads. Also the points
 * along a path, for its real ink bounds (curves and arcs sampled, not their control points).
 */

export type Segment =
  | { c: 'M' | 'L'; x: number; y: number }
  | { c: 'H'; x: number; y: number }
  | { c: 'V'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Q'; x1: number; y1: number; x: number; y: number }
  | { c: 'A'; rx: number; ry: number; rot: number; large: number; sweep: number; x: number; y: number }
  | { c: 'Z'; x: number; y: number };

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Every segment of `d` in absolute coordinates (S and T become C and Q). */
export function parsePath(d: string): Segment[] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for S and T.
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  let command = '';
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) throw new Error(`path data starts with a number: ${d}`);
    const upper = command.toUpperCase();
    if (!(upper in ARGS)) throw new Error(`unknown path command "${command}" in ${d}`);
    const rel = command !== upper;
    const n = ARGS[upper];
    const a: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = Number(tokens[i++]);
      if (Number.isNaN(v)) throw new Error(`a number expected after "${command}" in ${d}`);
      a.push(v);
    }
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let nextC: [number, number] | null = null;
    let nextQ: [number, number] | null = null;
    switch (upper) {
      case 'M':
        x = a[0] + ox;
        y = a[1] + oy;
        startX = x;
        startY = y;
        out.push({ c: 'M', x, y });
        // More pairs after M are lines.
        command = rel ? 'l' : 'L';
        break;
      case 'L':
        x = a[0] + ox;
        y = a[1] + oy;
        out.push({ c: 'L', x, y });
        break;
      case 'H':
        x = a[0] + ox;
        out.push({ c: 'H', x, y });
        break;
      case 'V':
        y = a[0] + oy;
        out.push({ c: 'V', x, y });
        break;
      case 'C':
      case 'S': {
        // The first control point: given, or the last one reflected (S, T), or the current point.
        const prev: [number, number] | null = lastC;
        const x1: number = upper === 'C' ? a[0] + ox : prev ? 2 * x - prev[0] : x;
        const y1: number = upper === 'C' ? a[1] + oy : prev ? 2 * y - prev[1] : y;
        const rest = upper === 'C' ? a.slice(2) : a;
        const x2 = rest[0] + ox;
        const y2 = rest[1] + oy;
        x = rest[2] + ox;
        y = rest[3] + oy;
        out.push({ c: 'C', x1, y1, x2, y2, x, y });
        nextC = [x2, y2];
        break;
      }
      case 'Q':
      case 'T': {
        // The first control point: given, or the last one reflected (S, T), or the current point.
        const prev: [number, number] | null = lastQ;
        const x1: number = upper === 'Q' ? a[0] + ox : prev ? 2 * x - prev[0] : x;
        const y1: number = upper === 'Q' ? a[1] + oy : prev ? 2 * y - prev[1] : y;
        const rest = upper === 'Q' ? a.slice(2) : a;
        x = rest[0] + ox;
        y = rest[1] + oy;
        out.push({ c: 'Q', x1, y1, x, y });
        nextQ = [x1, y1];
        break;
      }
      case 'A':
        x = a[5] + ox;
        y = a[6] + oy;
        out.push({ c: 'A', rx: Math.abs(a[0]), ry: Math.abs(a[1]), rot: a[2], large: a[3] ? 1 : 0, sweep: a[4] ? 1 : 0, x, y });
        break;
      case 'Z':
        x = startX;
        y = startY;
        out.push({ c: 'Z', x, y });
        command = ''; // Numbers straight after Z are an error, not more Zs.
        break;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return out;
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/** Path data in absolute M L H V C Q A Z only. */
export function writePath(segments: readonly Segment[]): string {
  return segments
    .map((s) => {
      switch (s.c) {
        case 'M':
        case 'L':
          return `${s.c}${num(s.x)} ${num(s.y)}`;
        case 'H':
          return `H${num(s.x)}`;
        case 'V':
          return `V${num(s.y)}`;
        case 'C':
          return `C${[s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(num).join(' ')}`;
        case 'Q':
          return `Q${[s.x1, s.y1, s.x, s.y].map(num).join(' ')}`;
        case 'A':
          return `A${num(s.rx)} ${num(s.ry)} ${num(s.rot)} ${s.large} ${s.sweep} ${num(s.x)} ${num(s.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

/** Moves every point with `f` (a uniform scale and a shift: arc radii scale by `scale`). */
export function mapPath(segments: readonly Segment[], f: (x: number, y: number) => [number, number], scale: number): Segment[] {
  return segments.map((s) => {
    const [x, y] = f(s.x, s.y);
    switch (s.c) {
      case 'C': {
        const [x1, y1] = f(s.x1, s.y1);
        const [x2, y2] = f(s.x2, s.y2);
        return { ...s, x1, y1, x2, y2, x, y };
      }
      case 'Q': {
        const [x1, y1] = f(s.x1, s.y1);
        return { ...s, x1, y1, x, y };
      }
      case 'A':
        return { ...s, rx: s.rx * scale, ry: s.ry * scale, x, y };
      default:
        return { ...s, x, y };
    }
  });
}

const STEPS = 32;

/** Points along an elliptical arc (SVG's endpoint form: radii too small for the chord grow to fit). */
function arcPoints(x0: number, y0: number, s: Extract<Segment, { c: 'A' }>): [number, number][] {
  let { rx, ry } = s;
  if (rx === 0 || ry === 0 || (x0 === s.x && y0 === s.y)) return [[s.x, s.y]];
  const phi = (s.rot * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - s.x) / 2;
  const dy = (y0 - s.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const grow = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + s.x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + s.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  const points: [number, number][] = [];
  for (let i = 1; i <= STEPS * 2; i++) {
    const t = t1 + (dt * i) / (STEPS * 2);
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return points;
}

/** Points along the whole outline: every end point, plus curves and arcs sampled finely. */
export function pathPoints(segments: readonly Segment[]): [number, number][] {
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const s of segments) {
    if (s.c === 'C') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const u = 1 - t;
        points.push([u * u * u * x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x, u * u * u * y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y]);
      }
    } else if (s.c === 'Q') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const u = 1 - t;
        points.push([u * u * x + 2 * u * t * s.x1 + t * t * s.x, u * u * y + 2 * u * t * s.y1 + t * t * s.y]);
      }
    } else if (s.c === 'A') {
      points.push(...arcPoints(x, y, s));
    } else {
      points.push([s.x, s.y]);
    }
    x = s.x;
    y = s.y;
  }
  return points;
}
