import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strings } from '../../strings';
import { JOURNEYS, getJourney, stageAt } from '../journeys';

describe('journeys config', () => {
  it('has the eight journeys, short to long, with the agreed lengths', () => {
    expect(JOURNEYS.map((j) => [j.id, j.steps])).toEqual([
      ['ocean_deep', 5],
      ['redwood_tree', 8],
      ['ocean_cliff', 10],
      ['skyscraper', 12],
      ['rapunzel_tower', 15],
      ['hot_air_balloon', 20],
      ['ladder_to_the_moon', 25],
      ['rocket_through_space', 30],
    ]);
  });

  it('only ocean deep goes down', () => {
    expect(JOURNEYS.filter((j) => j.direction === 'down').map((j) => j.id)).toEqual(['ocean_deep']);
  });

  it('each journey has 3-5 stages, inside its steps, in order, with text from en.ts', () => {
    for (const journey of JOURNEYS) {
      expect(journey.stages.length).toBeGreaterThanOrEqual(3);
      expect(journey.stages.length).toBeLessThanOrEqual(5);
      const steps = journey.stages.map((s) => s.step);
      expect([...steps].sort((a, b) => a - b)).toEqual(steps);
      expect(new Set(steps).size).toBe(steps.length);
      for (const stage of journey.stages) {
        expect(stage.step).toBeGreaterThanOrEqual(1);
        expect(stage.step).toBeLessThanOrEqual(journey.steps);
        expect(stage.label).toBeTruthy();
      }
      expect(journey.stages.map((s) => s.label)).toEqual([...strings.journeys[journey.id].stages]);
      expect(journey.emoji).toBeTruthy();
    }
  });

  it('ocean deep has the kelp forest, shipwreck and sea floor', () => {
    const ocean = getJourney('ocean_deep')!;
    expect([stageAt(ocean, 2), stageAt(ocean, 4), stageAt(ocean, 5), stageAt(ocean, 1)]).toEqual(['Kelp forest', 'Shipwreck', 'Sea floor', null]);
  });

  it('every theme colour is a CSS variable defined in theme.css', () => {
    const css = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
    for (const journey of JOURNEYS) expect(css).toContain(`${journey.colorVar}:`);
  });

  it('getJourney returns undefined for an unknown id', () => {
    expect(getJourney('nope')).toBeUndefined();
  });
});
