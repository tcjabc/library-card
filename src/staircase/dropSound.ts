import type { Thud } from './dropMotion';
import { readStackSounds } from './soundSetting';

/**
 * The thud of a book landing on the Family Staircase (Web Audio, synthesised: no sound files),
 * and its little vibration (Android; iOS has none). The parameters are dropMotion.thud's.
 *
 * Browsers only let a page make sound after a tap. The tap that opens the staircase (a link to
 * it) and any tap or key on the staircase itself creates or resumes the audio context
 * (installStackAudioUnlock, from main.tsx); nothing else in the app touches audio. Without that
 * (a reload straight onto the staircase), the thud is skipped silently.
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let noise: AudioBuffer | null = null;

function contextClass(): (new () => Ctx) | null {
  const w = window as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create or resume the audio context. Call only from a tap or key handler. */
export function unlockStackAudio(): void {
  if (!readStackSounds()) return;
  try {
    if (!ctx) {
      const Make = contextClass();
      if (!Make) return;
      ctx = new Make();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

/** A tap on the Family Staircase (or the developer tools' book stack, which replays drops), or on a link to it. */
function onStaircase(target: EventTarget | null): boolean {
  const hash = window.location.hash;
  if (/^#\/(?:staircase|dev\/stack)(?:$|[/?])/.test(hash) && !hash.startsWith('#/staircase/old')) return true;
  const el = target instanceof Element ? target.closest('a[href]') : null;
  return el?.getAttribute('href') === '#/staircase';
}

let installed = false;

/** Listen for the taps that may unlock audio (capture phase, so the opening tap counts before the screen changes). */
export function installStackAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const onGesture = (event: Event) => {
    if (onStaircase(event.target)) unlockStackAudio();
  };
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, onGesture, { capture: true, passive: true });
}

function noiseBuffer(c: Ctx, seconds: number): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate && noise.duration >= seconds) return noise;
  const length = Math.max(1, Math.ceil(c.sampleRate * seconds));
  noise = c.createBuffer(1, length, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

const SILENT = 0.0001;

/** Play one thud now. False (and silent) when sound is off, the page is hidden or audio isn't unlocked. */
export function playThud(p: Thud): boolean {
  if (!readStackSounds() || document.visibilityState !== 'visible' || !ctx || ctx.state !== 'running' || !(p.gain > 0)) return false;
  try {
    const c = ctx;
    const t = c.currentTime;
    // The body: a sine falling in pitch.
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.f0, t);
    osc.frequency.exponentialRampToValueAtTime(p.f1, t + p.sweep);
    const g = c.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.linearRampToValueAtTime(p.gain, t + p.attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t + p.release);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + p.release + 0.02);
    // The contact: a short burst of low-passed noise.
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, p.noiseLength);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(p.lowpass, t);
    const ng = c.createGain();
    ng.gain.setValueAtTime(SILENT, t);
    ng.gain.linearRampToValueAtTime(p.noiseGain, t + p.attack);
    ng.gain.exponentialRampToValueAtTime(SILENT, t + p.noiseLength);
    src.connect(filter).connect(ng).connect(c.destination);
    src.start(t);
    src.stop(t + p.noiseLength + 0.01);
    return true;
  } catch {
    return false;
  }
}

/** A short vibration where the device has one (Android), when sound is on, the page is visible and has been tapped. */
export function vibrateLanding(ms: number): void {
  if (!readStackSounds() || document.visibilityState !== 'visible') return;
  const nav = navigator as { vibrate?: (ms: number) => boolean; userActivation?: { hasBeenActive: boolean } };
  // Chrome refuses (and logs an error) before the page has been tapped: skip it quietly then.
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
  try {
    nav.vibrate?.(ms);
  } catch {
    // Not allowed here: nothing.
  }
}
