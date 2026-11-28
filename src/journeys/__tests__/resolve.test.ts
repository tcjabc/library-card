import { describe, expect, it } from 'vitest';
import { JOURNEY_THEMES, type CustomJourney } from '../../data';
import { strings } from '../../strings';
import { getJourney, JOURNEYS } from '../journeys';
import { customJourneyDefinition, loadJourney, resolveJourney, scaleStages } from '../resolve';

// 1.25.0: one resolver for built-in and custom journeys (src/journeys/resolve.ts).

const custom = (over: Partial<CustomJourney> = {}): CustomJourney => ({
  id: '0b9c4d6e-1111-4a2b-9c3d-123456789abc',
  household_id: 'main',
  theme: 'rocket_through_space',
  steps: 12,
  name: null,
  created_at: '2026-01-01T00:00:00.000Z',
  archived_at: null,
  ...over,
});
const ref = (c: CustomJourney) => `custom:${c.id}`;
const noStore = { getCustomJourney: () => Promise.reject(new Error('a built-in must not read storage')) };

describe('built-in journeys resolve exactly as before', () => {
  it('the data layer’s themes are the eight built-in journeys, in order', () => {
    expect([...JOURNEY_THEMES]).toEqual(JOURNEYS.map((j) => j.id));
  });

  it('every built-in resolves to its own definition object, with or without custom journeys, and without reading storage', async () => {
    for (const journey of JOURNEYS) {
      expect(resolveJourney(journey.id, [])).toBe(journey);
      expect(resolveJourney(journey.id, [custom({ theme: journey.id })])).toBe(journey);
      expect(await loadJourney(noStore, journey.id)).toBe(journey);
      expect([journey.theme, journey.isCustom]).toEqual([journey.id, false]);
    }
  });

  it('each built-in’s definition is the 1.24 one (fields pinned), plus theme = id and isCustom = false', () => {
    const pinned = JOURNEYS.map(({ id, title, emoji, steps, direction, colorVar, stages }) => ({ id, title, emoji, steps, direction, colorVar, stages: stages.map((s) => `${s.step}:${s.label}`).join('|') }));
    expect(pinned).toEqual([
      { id: 'ocean_deep', title: 'Ocean Deep', emoji: '🐋', steps: 5, direction: 'down', colorVar: '--journey-ocean-deep', stages: '2:Kelp forest|4:Shipwreck|5:Sea floor' },
      { id: 'redwood_tree', title: 'Redwood Tree', emoji: '🌲', steps: 8, direction: 'up', colorVar: '--journey-redwood-tree', stages: '2:Mossy roots|4:First branches|6:Squirrel nest|8:The treetop' },
      { id: 'ocean_cliff', title: 'Ocean Cliff', emoji: '🪨', steps: 10, direction: 'up', colorVar: '--journey-ocean-cliff', stages: '2:Rock pools|5:Seabird ledges|8:Windy path|10:The lighthouse' },
      { id: 'skyscraper', title: 'Skyscraper', emoji: '🏙️', steps: 12, direction: 'up', colorVar: '--journey-skyscraper', stages: '3:The lobby|6:Sky lobby|9:Observation deck|12:The roof' },
      { id: 'rapunzel_tower', title: 'Rapunzel’s Tower', emoji: '🏰', steps: 15, direction: 'up', colorVar: '--journey-rapunzel-tower', stages: expect.stringMatching(/^3:.*\|7:.*\|11:.*\|15:/) },
      { id: 'hot_air_balloon', title: 'Hot-Air Balloon', emoji: '🎈', steps: 20, direction: 'up', colorVar: '--journey-hot-air-balloon', stages: expect.stringMatching(/^4:.*\|8:.*\|12:.*\|16:.*\|20:/) },
      { id: 'ladder_to_the_moon', title: 'Ladder to the Moon', emoji: '🌙', steps: 25, direction: 'up', colorVar: '--journey-ladder-to-the-moon', stages: expect.stringMatching(/^5:.*\|10:.*\|15:.*\|20:.*\|25:/) },
      { id: 'rocket_through_space', title: 'Rocket Through Space', emoji: '🚀', steps: 30, direction: 'up', colorVar: '--journey-rocket-through-space', stages: '5:Lift off|12:In orbit|18:Past the moon|24:Asteroid belt|30:A new planet' },
    ]);
  });
});

describe('custom journeys', () => {
  it('take their theme’s look and direction, their own length, and a name or "<Theme> · N books"', () => {
    const plain = custom({ theme: 'ocean_deep', steps: 9 });
    const named = custom({ id: 'c2', theme: 'hot_air_balloon', steps: 3, name: 'Up we go' });
    const a = resolveJourney(ref(plain), [plain, named])!;
    const b = resolveJourney(ref(named), [plain, named])!;
    const sea = getJourney('ocean_deep')!;
    expect(a).toMatchObject({ id: ref(plain), theme: 'ocean_deep', isCustom: true, archived: false, emoji: sea.emoji, direction: 'down', colorVar: sea.colorVar, steps: 9, title: 'Ocean Deep · 9 books' });
    expect(b).toMatchObject({ id: 'custom:c2', theme: 'hot_air_balloon', title: 'Up we go', steps: 3, direction: 'up' });
    expect(strings.journey.customDefaultName).toBe('{theme} · {count} books');
  });

  it('an archived one still resolves (readers on it keep going), flagged', () => {
    const old = custom({ archived_at: '2026-02-01T00:00:00.000Z' });
    expect(resolveJourney(ref(old), [old])).toMatchObject({ steps: 12, archived: true, title: 'Rocket Through Space · 12 books' });
  });

  it('a custom ref with no record, an unknown id or an unknown theme resolves to nothing (as unknown ids always have)', () => {
    expect(resolveJourney('custom:missing', [custom()])).toBeUndefined();
    expect(resolveJourney('space_station', [custom()])).toBeUndefined();
    expect(resolveJourney('custom:', [custom()])).toBeUndefined();
    expect(customJourneyDefinition(custom({ theme: 'space_station' as never }))).toBeUndefined();
  });

  it('loadJourney reads only the one record a custom ref names', async () => {
    const c = custom({ steps: 30 });
    const asked: string[] = [];
    const store = { getCustomJourney: async (id: string) => (asked.push(id), id === c.id ? c : null) };
    expect((await loadJourney(store, ref(c)))?.steps).toBe(30);
    expect(await loadJourney(store, 'custom:other')).toBeUndefined();
    expect(asked).toEqual([c.id, 'other']);
  });
});

describe('scaleStages', () => {
  const rocket = getJourney('rocket_through_space')!;
  const deep = getJourney('ocean_deep')!;
  const at = (theme: typeof rocket, n: number) => scaleStages(theme, n).map((s) => `${s.step}:${s.label}`);

  it('at the theme’s own length: the same stages', () => {
    for (const journey of JOURNEYS) expect(scaleStages(journey, journey.steps)).toEqual(journey.stages);
  });

  it('scaled and rounded, the last stage on the last step, duplicates dropped', () => {
    expect(at(rocket, 15)).toEqual(['3:Lift off', '6:In orbit', '9:Past the moon', '12:Asteroid belt', '15:A new planet']);
    expect(at(rocket, 10)).toEqual(['2:Lift off', '4:In orbit', '6:Past the moon', '8:Asteroid belt', '10:A new planet']);
    // 3 books: Lift off 0.5→1, In orbit 1.2→1 (taken), Past the moon 1.8→2, Asteroid belt 2.4→2 (taken).
    expect(at(rocket, 3)).toEqual(['1:Lift off', '2:Past the moon', '3:A new planet']);
    // Ocean Deep (5): Kelp forest 2, Shipwreck 4, Sea floor 5; at 30: 12, 24, 30; at 3: 1, 2, 3.
    expect(at(deep, 30)).toEqual(['12:Kelp forest', '24:Shipwreck', '30:Sea floor']);
    expect(at(deep, 3)).toEqual(['1:Kelp forest', '2:Shipwreck', '3:Sea floor']);
  });

  it('every theme at every length 3–30: steps within 1..N, increasing, unique, the last on N', () => {
    for (const journey of JOURNEYS) {
      for (let n = 3; n <= 30; n++) {
        const stages = scaleStages(journey, n);
        expect(stages.at(-1)).toEqual({ step: n, label: journey.stages.at(-1)!.label });
        for (let i = 1; i < stages.length; i++) expect(stages[i].step).toBeGreaterThan(stages[i - 1].step);
        expect(stages[0].step).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
