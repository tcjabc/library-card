import { strings } from '../strings';

/**
 * Reading Journeys. A reader picks one from the gallery; each book they read
 * for the FIRST time after starting climbs one step (re-reads don't count).
 * The journey is complete when every step is filled.
 *
 * Tune the numbers here: `steps` is how many books a journey takes, and
 * `stageSteps` says at which steps its stage labels (in en.ts, same order)
 * appear. The last stage is usually the finish.
 * Colours are CSS variables in src/theme.css.
 */

export type JourneyDirection = 'up' | 'down';

export interface JourneyStage {
  step: number;
  label: string;
}

export interface Journey {
  id: JourneyId;
  title: string;
  emoji: string;
  /** Books to finish. */
  steps: number;
  /** "up": the finish is at the top. "down": at the bottom (ocean deep). */
  direction: JourneyDirection;
  /** CSS custom property holding the journey's theme colour. */
  colorVar: string;
  stages: readonly JourneyStage[];
}

const CONFIG = {
  ocean_deep: { emoji: '🐋', steps: 5, direction: 'down', stageSteps: [2, 4, 5] },
  redwood_tree: { emoji: '🌲', steps: 8, direction: 'up', stageSteps: [2, 4, 6, 8] },
  ocean_cliff: { emoji: '🪨', steps: 10, direction: 'up', stageSteps: [2, 5, 8, 10] },
  skyscraper: { emoji: '🏙️', steps: 12, direction: 'up', stageSteps: [3, 6, 9, 12] },
  rapunzel_tower: { emoji: '🏰', steps: 15, direction: 'up', stageSteps: [3, 7, 11, 15] },
  hot_air_balloon: { emoji: '🎈', steps: 20, direction: 'up', stageSteps: [4, 8, 12, 16, 20] },
  ladder_to_the_moon: { emoji: '🌙', steps: 25, direction: 'up', stageSteps: [5, 10, 15, 20, 25] },
  rocket_through_space: { emoji: '🚀', steps: 30, direction: 'up', stageSteps: [5, 12, 18, 24, 30] },
} as const satisfies Record<string, { emoji: string; steps: number; direction: JourneyDirection; stageSteps: readonly number[] }>;

export type JourneyId = keyof typeof CONFIG;

/** Short to long, as the gallery shows them. */
export const JOURNEYS: readonly Journey[] = (Object.keys(CONFIG) as JourneyId[]).map((id) => {
  const config = CONFIG[id];
  const text = strings.journeys[id];
  return {
    id,
    title: text.title,
    emoji: config.emoji,
    steps: config.steps,
    direction: config.direction,
    colorVar: `--journey-${id.replace(/_/g, '-')}`,
    stages: config.stageSteps.map((step, i) => ({ step, label: text.stages[i] })),
  };
});

export function getJourney(id: string): Journey | undefined {
  return JOURNEYS.find((journey) => journey.id === id);
}

/** The stage label shown at a step, if any. */
export function stageAt(journey: Journey, step: number): string | null {
  return journey.stages.find((stage) => stage.step === step)?.label ?? null;
}
