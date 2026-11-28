import { customJourneyIdOf, type CustomJourney, type DataStore } from '../data';
import { fmt, strings } from '../strings';
import { getJourney, type Journey, type JourneyStage } from './journeys';

/**
 * One journey definition for any journey a reader can be on (1.25.0): a built-in one from
 * journeys.ts, or a household's custom journey ("custom:<id>", src/data CustomJourney) drawn from
 * a built-in theme at a length of its own. Everything that shows or checks a reader's journey goes
 * through here; the scene, art, colours, direction and poster art follow `theme`, never `id`.
 * docs/custom-journeys-plan.md.
 */
export interface ResolvedJourney extends Omit<Journey, 'id' | 'isCustom'> {
  /** The id a reader's journey_id holds: a built-in id, or "custom:<id>". */
  id: string;
  isCustom: boolean;
  /** An archived custom journey still resolves: readers on it keep going, history keeps its name. */
  archived?: boolean;
  /** A custom journey's name, or its theme's when it has none: for a card that shows "N books" too. */
  shortTitle?: string;
}

/** "<Theme> · N books", for a custom journey with no name of its own. */
export function customJourneyDefaultName(themeTitle: string, steps: number): string {
  return fmt(strings.journey.customDefaultName, { theme: themeTitle, count: steps });
}

/**
 * A theme's stage labels at another length: each stage at stage × N / the theme's steps, rounded
 * (at least step 1); the last stage on the last step, and any other that lands on or past it, or on
 * a step already labelled, dropped.
 */
export function scaleStages(theme: Pick<Journey, 'steps' | 'stages'>, steps: number): JourneyStage[] {
  if (!theme.stages.length) return [];
  const last = theme.stages[theme.stages.length - 1];
  const out: JourneyStage[] = [];
  const taken = new Set<number>([steps]);
  for (const stage of theme.stages.slice(0, -1)) {
    const step = Math.max(1, Math.round((stage.step * steps) / theme.steps));
    if (taken.has(step) || step > steps) continue;
    taken.add(step);
    out.push({ step, label: stage.label });
  }
  out.push({ step: steps, label: last.label });
  return out.sort((a, b) => a.step - b.step);
}

/** A custom journey as a definition, or undefined if its theme isn't one this version has. */
export function customJourneyDefinition(custom: CustomJourney): ResolvedJourney | undefined {
  const theme = getJourney(custom.theme);
  if (!theme) return undefined;
  return {
    ...theme,
    id: `custom:${custom.id}`,
    isCustom: true,
    title: custom.name ?? customJourneyDefaultName(theme.title, custom.steps),
    shortTitle: custom.name ?? theme.title,
    steps: custom.steps,
    stages: scaleStages(theme, custom.steps),
    archived: custom.archived_at !== null,
  };
}

/**
 * The definition for a journey id: a built-in one as it is (unchanged), a "custom:<id>" one from
 * `customs` (archived ones too), or undefined for an id this version can't resolve.
 */
export function resolveJourney(id: string, customs: readonly CustomJourney[]): ResolvedJourney | undefined {
  const builtIn = getJourney(id);
  if (builtIn) return builtIn;
  const customId = customJourneyIdOf(id);
  if (!customId) return undefined;
  const custom = customs.find((c) => c.id === customId);
  return custom ? customJourneyDefinition(custom) : undefined;
}

/** resolveJourney from storage: a built-in id needs no read at all; a custom one reads its record. */
export async function loadJourney(store: Pick<DataStore, 'getCustomJourney'>, id: string): Promise<ResolvedJourney | undefined> {
  const builtIn = getJourney(id);
  if (builtIn) return builtIn;
  const customId = customJourneyIdOf(id);
  if (!customId) return undefined;
  const custom = await store.getCustomJourney(customId);
  return custom ? customJourneyDefinition(custom) : undefined;
}

/**
 * The custom journeys a list shows (the gallery, the posters), as definitions, oldest first:
 * archived ones are left out, except `keep` (the journey a reader is on, which stays in their view).
 */
export function listedCustomJourneys(customs: readonly CustomJourney[], keep?: string): ResolvedJourney[] {
  return customs
    .filter((c) => c.archived_at === null || `custom:${c.id}` === keep)
    .map(customJourneyDefinition)
    .filter((j): j is ResolvedJourney => j !== undefined);
}
