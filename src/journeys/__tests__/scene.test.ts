import { describe, expect, it } from 'vitest';
import { isAppStorageKey } from '../../grownups/helpers';
import { JOURNEYS } from '../journeys';
import {
  JOURNEY_SEEN_PREFIX,
  journeySeenKey,
  openJourney,
  parseSeenStep,
  readSeenStep,
  settleFrom,
  writeSeenStep,
  type JourneySeenStorage,
} from '../journeySeen';
import {
  MAX_FACTOR,
  MAX_TRAVEL,
  SCENES,
  SCENE_LAYERS,
  layerOffset,
  layerTravel,
  sceneFor,
  sceneMotion,
  MIN_SETTLE_PX,
  settleOffsets,
  MIN_SCROLL_RANGE,
  scrollShift,
  stepShift,
} from '../scene';

describe('scenes: which journeys have one', () => {
  it('the two pilots, Hot-Air Balloon and Ocean Deep; every other journey keeps its plain track', () => {
    expect(Object.keys(SCENES).sort()).toEqual(['hot_air_balloon', 'ocean_deep']);
    for (const journey of JOURNEYS) expect(sceneFor(journey.id) !== null).toBe(journey.id in SCENES);
    expect(sceneFor('nope')).toBeNull();
  });

  it('far layers move least and near ones most', () => {
    for (const config of Object.values(SCENES)) {
      const [far, mid, near] = SCENE_LAYERS.map((layer) => layerTravel(config!, layer));
      expect(far).toBeLessThan(mid);
      expect(mid).toBeLessThan(near);
    }
  });
});

describe('layer offsets from the one shift value', () => {
  it('a layer moves up by shift × travel: 0 at the top end of the track, the whole travel at the bottom end', () => {
    expect(layerOffset(0, 500)).toBe(-0);
    expect(layerOffset(1, 500)).toBe(-500);
    expect(layerOffset(0.5, 500)).toBe(-250);
  });

  it('clamps the shift to 0–1 and the travel to ≥ 0', () => {
    expect(layerOffset(-1, 500)).toBe(-0);
    expect(layerOffset(2, 500)).toBe(-500);
    expect(layerOffset(Number.NaN, 500)).toBe(-0);
    expect(layerOffset(0.5, -100)).toBe(-0);
  });

  it('long journeys are clamped: no layer travels further than MAX_TRAVEL × MAX_FACTOR', () => {
    const wild = { travel: 99999, factors: { far: 0.2, mid: 9, near: -3 } };
    expect(layerTravel(wild, 'far')).toBeCloseTo(0.2 * MAX_TRAVEL, 9);
    expect(layerTravel(wild, 'mid')).toBe(MAX_FACTOR * MAX_TRAVEL);
    expect(layerTravel(wild, 'near')).toBe(0);
    for (const config of Object.values(SCENES)) for (const layer of SCENE_LAYERS) expect(layerTravel(config!, layer)).toBeLessThanOrEqual(MAX_TRAVEL);
  });

  it('the shift follows the page’s scroll from its top (0) to its bottom (1), clamped', () => {
    expect(scrollShift(0, 2000, 800, 0.5)).toBe(0);
    expect(scrollShift(500, 2000, 800, 0.5)).toBe(0.25);
    expect(scrollShift(2000, 2000, 800, 0.5)).toBe(1);
    expect(scrollShift(2600, 2000, 800, 0.5)).toBe(1);
    expect(scrollShift(-40, 2000, 800, 0.5)).toBe(0);
  });

  it(`a page that can scroll less than ${MIN_SCROLL_RANGE} of a view uses the reader's step instead (a short journey on a tall screen)`, () => {
    expect(scrollShift(10, 100, 800, 0.3)).toBe(0.3);
    expect(scrollShift(0, 0, 800, 0.8)).toBe(0.8);
    expect(scrollShift(200, MIN_SCROLL_RANGE * 800, 800, 0.3)).toBe(0.5);
  });
});

describe('direction: rising journeys move the world down as you climb, Ocean Deep up as you dive', () => {
  it('a rising journey starts at the bottom (shift near 1) and its finish is at the top (near 0)', () => {
    const start = stepShift(0, 20, 'up');
    const finish = stepShift(20, 20, 'up');
    expect(start).toBeGreaterThan(0.9);
    expect(finish).toBeLessThan(0.1);
    // Climbing a step: the shift falls, so every layer's offset rises towards 0, the world moves down.
    for (let step = 0; step < 20; step++) {
      expect(layerOffset(stepShift(step + 1, 20, 'up'), 500)).toBeGreaterThan(layerOffset(stepShift(step, 20, 'up'), 500));
    }
  });

  it('Ocean Deep starts at the top and dives: each step down moves the world up', () => {
    expect(stepShift(0, 5, 'down')).toBeLessThan(0.15);
    expect(stepShift(5, 5, 'down')).toBeGreaterThan(0.75);
    for (let step = 0; step < 5; step++) {
      expect(layerOffset(stepShift(step + 1, 5, 'down'), 300)).toBeLessThan(layerOffset(stepShift(step, 5, 'down'), 300));
    }
  });

  it('steps are clamped and rounded', () => {
    expect(stepShift(-3, 20, 'up')).toBe(stepShift(0, 20, 'up'));
    expect(stepShift(99, 20, 'up')).toBe(stepShift(20, 20, 'up'));
    expect(stepShift(4.4, 20, 'up')).toBe(stepShift(4, 20, 'up'));
    expect(stepShift(3, 0, 'up')).toBe(0);
  });

  it('the settle starts where the old step put each layer and ends at the new step', () => {
    const balloon = SCENES.hot_air_balloon!;
    const near = layerTravel(balloon, 'near');
    // A big jump on a rising journey (3 to 15): the proportional glide, the layer starting higher than where it settles.
    const big = settleOffsets(3, 15, 20, 'up', balloon);
    const proportional = layerOffset(stepShift(3, 20, 'up'), near) - layerOffset(stepShift(15, 20, 'up'), near);
    expect(Math.abs(proportional)).toBeGreaterThan(MIN_SETTLE_PX);
    expect(big.near).toBeCloseTo(proportional, 9);
    expect(big.near).toBeLessThan(0);
    // Diving (Ocean Deep): the layer starts lower than where it settles.
    expect(settleOffsets(1, 2, 5, 'down', SCENES.ocean_deep!).near).toBeGreaterThan(0);
  });

  it(`a one-step jump still glides the near layer at least ${MIN_SETTLE_PX} px, mid and far by their factors`, () => {
    const balloon = SCENES.hot_air_balloon!;
    const one = settleOffsets(10, 11, 20, 'up', balloon);
    expect(Math.abs(layerOffset(stepShift(10, 20, 'up'), layerTravel(balloon, 'near')) - layerOffset(stepShift(11, 20, 'up'), layerTravel(balloon, 'near')))).toBeLessThan(MIN_SETTLE_PX);
    expect(one.near).toBe(-MIN_SETTLE_PX);
    expect(one.mid).toBeCloseTo((-MIN_SETTLE_PX * balloon.factors.mid) / balloon.factors.near, 9);
    expect(one.far).toBeCloseTo((-MIN_SETTLE_PX * balloon.factors.far) / balloon.factors.near, 9);
    const ocean = settleOffsets(2, 3, 5, 'down', SCENES.ocean_deep!);
    expect(Math.abs(ocean.near)).toBeGreaterThanOrEqual(MIN_SETTLE_PX);
  });

  it('no change glides nothing; the glide never exceeds the near layer’s travel', () => {
    expect(settleOffsets(4, 4, 20, 'up', SCENES.hot_air_balloon!)).toEqual({ far: 0, mid: 0, near: 0 });
    const tiny = { travel: 40, factors: { far: 0.2, mid: 0.5, near: 1 } };
    const clamped = settleOffsets(0, 20, 20, 'up', tiny);
    expect(Math.abs(clamped.near)).toBeLessThanOrEqual(40);
    expect(Math.abs(settleOffsets(0, 1, 20, 'up', tiny).near)).toBe(40);
    for (const config of Object.values(SCENES)) {
      const all = settleOffsets(0, 30, 30, 'up', config!);
      expect(Math.abs(all.near)).toBeLessThanOrEqual(layerTravel(config!, 'near'));
    }
  });

  it('first open (no seen step) or no change: no settle at all', () => {
    expect(settleFrom(null, 7, true)).toBeNull();
    expect(settleFrom(7, 7, true)).toBeNull();
  });
});

describe('sceneMotion: Sky decoration and reduced motion', () => {
  it('Full: loops and parallax; Reduced: parallax only; None: still', () => {
    expect(sceneMotion('full', false)).toEqual({ loops: true, parallax: true, settle: true });
    expect(sceneMotion('reduced', false)).toEqual({ loops: false, parallax: true, settle: true });
    expect(sceneMotion('none', false)).toEqual({ loops: false, parallax: false, settle: false });
  });

  it('system reduced motion is always still: no loops, no parallax, no settle', () => {
    for (const decor of ['full', 'reduced', 'none'] as const) expect(sceneMotion(decor, true)).toEqual({ loops: false, parallax: false, settle: false });
  });
});

describe('the seen step (device-local, per reader and journey)', () => {
  const memory = (): JourneySeenStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  };

  it('is a library-card: key per reader and journey record, cleared by Reset this device', () => {
    const key = journeySeenKey('reader-1', 'journey-9');
    expect(key).toBe(`${JOURNEY_SEEN_PREFIX}reader-1:journey-9`);
    expect(isAppStorageKey(key)).toBe(true);
    expect(journeySeenKey('reader-1', 'journey-10')).not.toBe(key);
  });

  it('parses whole numbers only', () => {
    expect(parseSeenStep('7')).toBe(7);
    expect(parseSeenStep(' 0 ')).toBe(0);
    expect(parseSeenStep(null)).toBeNull();
    expect(parseSeenStep('-2')).toBeNull();
    expect(parseSeenStep('3.5')).toBeNull();
    expect(parseSeenStep('lots')).toBeNull();
  });

  it('settles only when the reader has climbed since last time, and motion is on', () => {
    expect(settleFrom(null, 4, true)).toBeNull();
    expect(settleFrom(4, 4, true)).toBeNull();
    expect(settleFrom(5, 4, true)).toBeNull();
    expect(settleFrom(2, 4, true)).toBe(2);
    expect(settleFrom(2, 4, false)).toBeNull();
  });

  it('first open: no settle; the next open after a read: one settle; and then never again', () => {
    const storage = memory();
    expect(openJourney(storage, 'r', 'j', 3, true)).toBeNull();
    expect(openJourney(storage, 'r', 'j', 3, true)).toBeNull();
    expect(openJourney(storage, 'r', 'j', 4, true)).toBe(3);
    expect(openJourney(storage, 'r', 'j', 4, true)).toBeNull();
  });

  it('records the step even with motion off, so turning it on later never replays an old change', () => {
    const storage = memory();
    openJourney(storage, 'r', 'j', 2, false);
    expect(openJourney(storage, 'r', 'j', 3, false)).toBeNull();
    expect(openJourney(storage, 'r', 'j', 3, true)).toBeNull();
  });

  it('a new journey record starts fresh; no storage (or a broken one) means no settle and no error', () => {
    const storage = memory();
    writeSeenStep(storage, 'r', 'old', 9);
    expect(readSeenStep(storage, 'r', 'new')).toBeNull();
    expect(openJourney(null, 'r', 'j', 3, true)).toBeNull();
    const broken: JourneySeenStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(openJourney(broken, 'r', 'j', 3, true)).toBeNull();
  });
});
