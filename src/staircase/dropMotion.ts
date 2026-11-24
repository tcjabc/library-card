/**
 * New books falling onto the Family Staircase's pile (pure, unit-tested): every constant in one
 * place, the drop plan, the physics step (gravity, bounce, the pile's spring, squash and dust),
 * where the camera goes, and the thud's and vibration's numbers. CanvasStack.tsx runs and draws
 * it; dropSound.ts plays the thud. The values are the approved mock-up's defaults.
 *
 * Units are the stack's world units (px in the pile: the thinnest book is 28), seconds for the
 * physics and milliseconds for the plan. Heights are a book's height above its resting place;
 * speeds are downward-positive.
 */
import { startPosition } from './camera';

// ---- The constants (the mock-up's defaults) ----

/** How heavy the books feel (the mock-up's slider, 1–10). */
export const WEIGHT = 5;
/** Gravity (world units/s²): 700 + 300 × weight, 2200 at weight 5. */
export const GRAVITY = gravityFor(WEIGHT);
/** A book starts falling this far above its resting place. */
export const DROP_HEIGHT = 420;
/** A book rebounds at this share of its impact speed… */
export const BOUNCE = 0.15;
/** …but only if that rebound would be faster than this (units/s); otherwise it stops. */
export const MIN_REBOUND = 130;
/** How much a landing squashes the book (0–1). */
export const SQUASH = 0.5;
/** A squashed book is this much thinner (× squash) and this much wider and deeper (× squash). */
export const SQUASH_THICKNESS = 0.45;
export const SQUASH_FOOTPRINT = 0.1;
/** Squash fades by exp(-SQUASH_DECAY × seconds). */
export const SQUASH_DECAY = 12;
/** How hard a landing pushes the pile down. */
export const JOLT = 14;
/** A landing adds JOLT × JOLT_SPEED × impulse to the pile's downward speed (units/s). */
export const JOLT_SPEED = 17;
/** The pile's spring: stiffness and damping (per s², per s). */
export const SPRING_K = 300;
export const SPRING_D = 18;
/** The push fades down the pile: exp(-books below the landing book / PILE_FALLOFF). */
export const PILE_FALLOFF = 3.5;
/** A falling book turns in by this much at the top of its fall (degrees), unwinding as it falls. */
export const SPIN_DEG = 60;
/** Between books (ms), and before the first one. */
export const STAGGER_MS = 260;
export const FIRST_MS = 120;
/** With more than NORMAL_LAST new books, the older ones fall in a quick burst this far apart (ms). */
export const BURST_MS = 50;
export const NORMAL_LAST = 8;
/** The whole drop is kept to about this long (ms): the plan is squeezed if the last book would land later. */
export const CAP_MS = 4000;
/** Allowed after the last book lands for its bounce and the pile's spring (ms), within the cap. */
export const TAIL_MS = 400;
/** Dust puffs on landing. */
export const DUST = true;
/** Each landing puffs this many specks (inclusive), lasting this long (s). */
export const DUST_COUNT: readonly [number, number] = [5, 10];
export const DUST_LIFE: readonly [number, number] = [0.5, 0.85];
/** The thud's loudness (0–1). */
export const VOLUME = 0.6;
/** A landing's impulse: impact speed over this, at most MAX_IMPULSE, times the book's mass. */
export const IMPULSE_SPEED = 1400;
export const MAX_IMPULSE = 1.4;
/** Mass: thickness over the 28-unit book, clamped, times weight / 5. */
export const MASS_BOOK = 28;
export const MASS_RANGE: readonly [number, number] = [0.45, 2.5];
/** Vibration on landing (ms, Android), from a soft to a hard landing. */
export const VIBRATE_MS: readonly [number, number] = [15, 25];
/** A landed book's markers (flag, month line) fade in over this long (ms). */
export const MARKER_FADE_MS = 300;
/** Reduced motion or too many books: a calm outline pulse this long (ms). */
export const HIGHLIGHT_MS = 600;
/** The physics runs in steps no longer than this (s), whatever the frame rate. */
const MAX_STEP_S = 0.004;

export function gravityFor(weight: number): number {
  return 700 + 300 * weight;
}

export function bookMass(thickness: number, weight = WEIGHT): number {
  const [lo, hi] = MASS_RANGE;
  return Math.min(hi, Math.max(lo, thickness / MASS_BOOK)) * (weight / 5);
}

export function impactImpulse(speed: number, mass: number): number {
  return Math.min(MAX_IMPULSE, Math.max(0, speed) / IMPULSE_SPEED) * mass;
}

/** How long a fall from `height` takes (s). */
export function fallTime(height = DROP_HEIGHT, g = GRAVITY): number {
  return Math.sqrt((2 * Math.max(0, height)) / g);
}

/** How fast a fall from `height` lands (units/s). */
export function landingSpeed(height = DROP_HEIGHT, g = GRAVITY): number {
  return Math.sqrt(2 * g * Math.max(0, height));
}

// ---- The plan ----

/**
 * When each new book is let go (ms from the start; oldest new book first): FIRST_MS, then
 * STAGGER_MS apart. With more than NORMAL_LAST books, all but the last NORMAL_LAST go BURST_MS
 * apart first. Squeezed (never reordered) so the last book lands within about CAP_MS.
 */
export function dropDelays(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const burst = Math.max(0, n - NORMAL_LAST);
  const delays: number[] = [];
  let at = FIRST_MS;
  for (let k = 0; k < n; k++) {
    delays.push(at);
    at += k < burst - 1 ? BURST_MS : STAGGER_MS;
  }
  if (n < 2) return delays;
  const last = delays[n - 1];
  const room = CAP_MS - fallTime() * 1000 - TAIL_MS;
  if (last <= room) return delays;
  const squeeze = (room - FIRST_MS) / (last - FIRST_MS);
  return delays.map((d) => FIRST_MS + (d - FIRST_MS) * squeeze);
}

// ---- The world ----

export type FallerState = 'waiting' | 'falling' | 'resting';

export interface Faller {
  /** The book's index in the pile (oldest first). */
  index: number;
  /** Let go this long after the start (ms). */
  delay: number;
  /** Height above its resting place (units), and downward speed (units/s). */
  h: number;
  v: number;
  state: FallerState;
  impacts: number;
}

export interface Dust {
  index: number;
  /** Which lower corner of the book: -1 left, 1 right. */
  side: -1 | 1;
  /** Offset from that corner (px) and speed (px/s). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

export interface DropWorld {
  /** Time since the start (ms). */
  t: number;
  /** Bottom (oldest) first. */
  fallers: Faller[];
  /** The pile's push down (units, positive down), its speed, and the book that landed last. */
  comp: number;
  compV: number;
  at: number;
  squash: Map<number, number>;
  dust: Dust[];
  /** When each book first landed (ms). */
  landedAt: Map<number, number>;
}

/** A drop of books [start, end) (oldest first), all waiting. */
export function startDrop(start: number, end: number): DropWorld {
  const delays = dropDelays(end - start);
  return {
    t: 0,
    fallers: delays.map((delay, k) => ({ index: start + k, delay, h: DROP_HEIGHT, v: 0, state: 'waiting', impacts: 0 })),
    comp: 0,
    compV: 0,
    at: start,
    squash: new Map(),
    dust: [],
    landedAt: new Map(),
  };
}

/** More books arriving at the top during a drop: let go after the ones already waiting, STAGGER_MS apart. */
export function addFallers(world: DropWorld, start: number, end: number): void {
  const last = world.fallers.length > 0 ? world.fallers[world.fallers.length - 1].delay : world.t;
  let at = Math.max(world.t + FIRST_MS, last + STAGGER_MS);
  const known = new Set(world.fallers.map((f) => f.index));
  for (let i = start; i < end; i++) {
    if (known.has(i)) continue;
    world.fallers.push({ index: i, delay: at, h: DROP_HEIGHT, v: 0, state: 'waiting', impacts: 0 });
    at += STAGGER_MS;
  }
  world.fallers.sort((a, b) => a.index - b.index);
}

export interface Impact {
  index: number;
  /** How fast it met what it landed on (units/s). */
  speed: number;
  mass: number;
  impulse: number;
  /** Its first landing (sound, vibration, dust, markers); later ones are its bounce settling. */
  first: boolean;
}

/** A small seeded random number generator (mulberry32), so a drop's dust is the same every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function puff(world: DropWorld, index: number): void {
  if (!DUST) return;
  const rng = seeded(index * 7919 + 17);
  const [lo, hi] = DUST_COUNT;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  for (let k = 0; k < count; k++) {
    const side: -1 | 1 = k % 2 === 0 ? -1 : 1;
    world.dust.push({
      index,
      side,
      x: 0,
      y: 0,
      vx: side * (30 + rng() * 70),
      vy: -(10 + rng() * 40),
      r: 1.5 + rng() * 2.5,
      age: 0,
      life: DUST_LIFE[0] + rng() * (DUST_LIFE[1] - DUST_LIFE[0]),
    });
  }
}

function land(world: DropWorld, f: Faller, speed: number, thickness: number, out: Impact[]): void {
  const mass = bookMass(thickness);
  const impulse = impactImpulse(speed, mass);
  const first = f.impacts === 0;
  f.impacts += 1;
  world.compV += JOLT * JOLT_SPEED * impulse;
  world.at = f.index;
  world.squash.set(f.index, Math.max(world.squash.get(f.index) ?? 0, Math.min(1, impulse) * SQUASH));
  if (first) {
    world.landedAt.set(f.index, world.t);
    puff(world, f.index);
  }
  out.push({ index: f.index, speed, mass, impulse, first });
}

function step(world: DropWorld, dt: number, thicknessOf: (index: number) => number, out: Impact[]): void {
  world.t += dt * 1000;
  let below: Faller | null = null;
  for (const f of world.fallers) {
    // What it lands on: the book under it if that one is also new (it may still be moving), else the pile.
    const under = below && below.index === f.index - 1 ? below : null;
    const floor = under && under.state !== 'waiting' ? under.h : 0;
    const floorV = under && under.state !== 'waiting' ? under.v : 0;
    if (f.state === 'waiting' && world.t >= f.delay) f.state = 'falling';
    if (f.state === 'falling') {
      const v1 = f.v + GRAVITY * dt;
      const h1 = f.h - ((f.v + v1) / 2) * dt;
      if (h1 <= floor) {
        // Met the floor during this step: its speed then, from where it was.
        const reach = Math.sqrt(Math.max(0, f.v * f.v + 2 * GRAVITY * Math.max(0, f.h - floor)));
        const speed = Math.max(0, reach - floorV);
        f.h = floor;
        // It bounces only off something still (the pile, or a book settled in its place): landing
        // on a book that's still moving, it settles onto it and rides it down.
        const solid = !under || (under.state === 'resting' && under.h === 0 && under.v === 0);
        if (solid && speed * BOUNCE > MIN_REBOUND) {
          f.v = -speed * BOUNCE;
        } else {
          f.v = floorV;
          f.state = 'resting';
        }
        land(world, f, speed, thicknessOf(f.index), out);
      } else {
        f.h = h1;
        f.v = v1;
      }
    } else if (f.state === 'resting') {
      // Rests on what's under it, riding it if that's still settling.
      f.h = floor;
      f.v = floorV;
    }
    below = f;
  }
  // The pile's spring, settling exactly to rest.
  world.compV += (-SPRING_K * world.comp - SPRING_D * world.compV) * dt;
  world.comp += world.compV * dt;
  if (Math.abs(world.comp) < 0.02 && Math.abs(world.compV) < 0.5) {
    world.comp = 0;
    world.compV = 0;
  }
  const fade = Math.exp(-SQUASH_DECAY * dt);
  for (const [index, sq] of world.squash) {
    const next = sq * fade;
    if (next < 0.003) world.squash.delete(index);
    else world.squash.set(index, next);
  }
  const drag = Math.exp(-4 * dt);
  world.dust = world.dust.filter((d) => {
    d.age += dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= drag;
    d.vy *= drag;
    return d.age < d.life;
  });
}

/** Moves the world on by `dtMs`, in short steps; the landings that happened, in order. */
export function stepDrop(world: DropWorld, dtMs: number, thicknessOf: (index: number) => number): Impact[] {
  const out: Impact[] = [];
  let left = Math.max(0, dtMs) / 1000;
  while (left > 1e-9) {
    const dt = Math.min(MAX_STEP_S, left);
    step(world, dt, thicknessOf, out);
    left -= dt;
  }
  return out;
}

/** Whether anything still moves: a book waiting or in the air, the spring, a squash or dust. */
export function dropActive(world: DropWorld): boolean {
  return (
    world.fallers.some((f) => f.state !== 'resting') || world.comp !== 0 || world.compV !== 0 || world.squash.size > 0 || world.dust.length > 0
  );
}

// ---- What each book looks like ----

/**
 * How far the pile's push moves book `index` down (units): the push itself for the landing book
 * and everything above it (in flight or landed later), fading down the pile below it.
 */
export function pileOffset(world: DropWorld, index: number): number {
  if (world.comp === 0) return 0;
  return index >= world.at ? world.comp : world.comp * Math.exp(-(world.at - index) / PILE_FALLOFF);
}

export function fallerOf(world: DropWorld, index: number): Faller | undefined {
  const first = world.fallers[0];
  if (!first) return undefined;
  const f = world.fallers[index - first.index];
  return f && f.index === index ? f : world.fallers.find((x) => x.index === index);
}

/** Whether a book isn't drawn yet: it hasn't been let go. */
export function waiting(world: DropWorld, index: number): boolean {
  return fallerOf(world, index)?.state === 'waiting';
}

/** A book's lift from the drop (units, up): its height in the air, less the pile's push. */
export function dropLift(world: DropWorld, index: number): number {
  const f = fallerOf(world, index);
  return (f && f.state !== 'waiting' ? f.h : 0) - pileOffset(world, index);
}

/** The spin-in: SPIN_DEG at the top of the fall, unwinding to 0 as it lands. */
export function spinYaw(h: number): number {
  return SPIN_DEG * Math.min(1, Math.max(0, h / DROP_HEIGHT));
}

/** A book's extra turn now (degrees). */
export function dropSpin(world: DropWorld, index: number): number {
  const f = fallerOf(world, index);
  return f && f.state !== 'waiting' && f.impacts === 0 ? spinYaw(f.h) : 0;
}

/** How a squashed book's thickness and footprint are scaled. */
export function squashScale(sq: number): { thickness: number; footprint: number } {
  return { thickness: 1 - SQUASH_THICKNESS * sq, footprint: 1 + SQUASH_FOOTPRINT * sq };
}

/** A book's markers: hidden until it lands, then fading in. 1 for books that aren't falling. */
export function markerAlpha(world: DropWorld, index: number): number {
  const f = fallerOf(world, index);
  if (!f) return 1;
  const at = world.landedAt.get(index);
  if (at === undefined) return 0;
  return Math.min(1, Math.max(0, (world.t - at) / MARKER_FADE_MS));
}

/** How many of the drop's books have landed (at least once). */
export function landedCount(world: DropWorld): number {
  return world.landedAt.size;
}

// ---- The camera ----

/**
 * Where the camera is while the pile is `landed` books tall: the normal opening rule for a pile
 * that size (camera.startPosition). So a pile that fits keeps the camera on its base book (the
 * books fall above the eye line); a tall pile has it on the highest landed book, easing up as
 * each one lands; a pile that grows past K moves from the base to the newest, eased, no jump.
 */
export function dropCamera(landed: number, k: number): number {
  return startPosition(landed, k);
}

// ---- Sound and vibration ----

export interface Thud {
  /** A sine falling exponentially from f0 to f1 (Hz) over `sweep` (s). */
  f0: number;
  f1: number;
  sweep: number;
  /** Its gain: up in `attack` (s), down to silence by `release` (s). */
  gain: number;
  attack: number;
  release: number;
  /** A noise burst through a low-pass filter. */
  noiseGain: number;
  noiseLength: number;
  lowpass: number;
}

export function thud(mass: number, impulse: number, weight = WEIGHT, volume = VOLUME): Thud {
  const gain = Math.min(1, Math.max(0, impulse)) * volume;
  return {
    f0: Math.min(200, Math.max(60, 190 - 11 * weight - 14 * Math.min(mass, MASS_RANGE[1]))),
    f1: 40,
    sweep: 0.2,
    gain,
    attack: 0.006,
    release: 0.3,
    noiseGain: 0.6 * gain,
    noiseLength: 0.09,
    lowpass: 700 - 40 * weight,
  };
}

/** How long to vibrate for a landing (ms): soft to hard. */
export function vibrationMs(impulse: number): number {
  const [lo, hi] = VIBRATE_MS;
  return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, impulse)));
}

// ---- The highlight (reduced motion, or too many books) ----

/** The outline's strength `ms` into the highlight: one calm pulse, 0 before and after. */
export function highlightAlpha(ms: number): number {
  if (!(ms > 0) || ms >= HIGHLIGHT_MS) return 0;
  return Math.sin((Math.PI * ms) / HIGHLIGHT_MS);
}
