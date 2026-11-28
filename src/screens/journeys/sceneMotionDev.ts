import { useSyncExternalStore } from 'react';
import type { JourneyId } from '../../journeys/journeys';
import type { SceneMotionWhy } from '../../journeys/sceneBudget';
import type { Decor } from '../../staircase/drawBudget';
import { deviceSwitch } from '../../staircase/deviceSwitch';

/**
 * Developer tools for the journey scenes' slow-device drop-out (src/journeys/sceneBudget.ts):
 *
 * - "Pretend slow frames on journey screens": every measured frame counts as at least
 *   PRETEND_SLOW_FRAME_MS long (drawBudget.budgetFrameMs), so the drop-out can be seen on a fast
 *   device. This device only (localStorage, off unless switched on, cleared by "Reset this
 *   device"), separate from the book stack's own switch.
 * - The last journey screen's motion: its level, why, the setting, this visit's cap and when it
 *   stepped down. Kept in memory until the app closes, never stored or sent.
 */

export const JOURNEY_SLOW_KEY = 'library-card:journey-slow';

const slow = deviceSwitch(JOURNEY_SLOW_KEY, { defaultOn: false });

export const readJourneySlow = slow.read;
export const writeJourneySlow = slow.write;
export const useJourneySlow = slow.use;

/** One step down this visit: from a level to the next, this long (ms) after the screen opened. */
export interface SceneStep {
  from: Decor;
  to: Decor;
  atMs: number;
}

export interface SceneMotionReadout {
  journeyId: JourneyId;
  level: Decor;
  why: SceneMotionWhy;
  setting: Decor;
  cap: Decor;
  steps: readonly SceneStep[];
}

let latest: SceneMotionReadout | null = null;
const listeners = new Set<() => void>();

/** The journey screen reports its motion when it changes (never per frame). */
export function publishSceneMotion(readout: SceneMotionReadout): void {
  latest = readout;
  listeners.forEach((fn) => fn());
}

export function readSceneMotion(): SceneMotionReadout | null {
  return latest;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The last journey screen's motion this session, re-rendering when it changes. */
export function useSceneMotionReadout(): SceneMotionReadout | null {
  return useSyncExternalStore(subscribe, readSceneMotion, () => null);
}
