import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CustomJourney } from '../../data';
import { JourneyPoster } from '../cards/JourneyPoster';
import CustomJourneyForm from '../journeys/CustomJourneyForm';
import { DEFAULT_LENGTH, LENGTH_PRESETS, clampLength, formProblem, lengthRange } from '../journeys/customJourneyRules';
import { getJourney } from '../../journeys/journeys';
import { customJourneyDefinition, listedCustomJourneys, resolveJourney } from '../../journeys/resolve';
import { POSTER_JOURNEYS } from '../../posters/art';
import { fitPosterTitle, POSTER_FRAME, POSTER_TYPE, TITLE_WIDTH } from '../../posters/posterLayout';
import { strings } from '../../strings';

// 1.26.0: custom journeys in Grown-ups, the gallery and the posters (Node, no DOM).

const t = strings.grownups.customJourneys;
let n = 0;
const custom = (over: Partial<CustomJourney> = {}): CustomJourney => ({
  id: `c${++n}`,
  household_id: 'main',
  theme: 'rocket_through_space',
  steps: 10,
  name: null,
  created_at: `2026-01-0${Math.min(9, n)}T00:00:00.000Z`,
  archived_at: null,
  ...over,
});

describe('the form’s rules', () => {
  it('a new journey: 3–30 books, 10 at first, presets 5, 10, 20, 30', () => {
    expect(lengthRange(null)).toEqual({ min: 3, max: 30 });
    expect(DEFAULT_LENGTH).toBe(10);
    expect([...LENGTH_PRESETS]).toEqual([5, 10, 20, 30]);
    expect([clampLength(1, null), clampLength(31, null), clampLength(7, null)]).toEqual([3, 30, 7]);
  });

  it('an edit: only longer, from its current length', () => {
    const j = custom({ steps: 12 });
    expect(lengthRange(j)).toEqual({ min: 12, max: 30 });
    expect([clampLength(5, j), clampLength(13, j)]).toEqual([12, 13]);
  });

  it('a picture is required; a name of more than 100 characters and a shorter length are refused, in plain words', () => {
    expect(formProblem({ theme: null, steps: 10, name: '' }, null)).toBe(t.pickTheme);
    expect(formProblem({ theme: 'ocean_deep', steps: 10, name: 'x'.repeat(101) }, null)).toBe(t.nameTooLong);
    expect(formProblem({ theme: 'ocean_deep', steps: 10, name: ` ${'x'.repeat(100)} ` }, null)).toBeNull();
    expect(formProblem({ theme: 'ocean_deep', steps: 9, name: '' }, custom({ steps: 12 }))).toBe(t.tooShort);
    expect(formProblem({ theme: 'ocean_deep', steps: 2, name: '' }, null)).not.toBeNull();
    expect(formProblem({ theme: 'ocean_deep', steps: 30, name: '' }, null)).toBeNull();
  });
});

describe('the form’s markup', () => {
  const render = (journey: CustomJourney | null) =>
    renderToStaticMarkup(createElement(CustomJourneyForm, { store: {} as never, householdId: 'main', journey, onClose: () => {} }));

  it('a new journey: eight pictures, each with its poster art; Save waits for a picture; the length at 10', () => {
    const html = render(null);
    expect(html.match(/class="custom-journey-theme"/g)).toHaveLength(8);
    expect(html.match(/class="custom-journey-theme__art"/g)).toHaveLength(8);
    expect(html).toMatch(/<button type="submit" class="btn btn--primary" disabled="">/);
    expect(html).toContain('>10</output>');
    expect(html).not.toContain(t.themeLocked);
  });

  it('an edit: the picture shown but locked, with the note; the length can only go up from where it is', () => {
    const html = render(custom({ theme: 'ocean_deep', steps: 20, name: 'Deep dive' }));
    expect(html.match(/class="custom-journey-theme"/g)).toHaveLength(1);
    expect(html).toMatch(/class="custom-journey-theme" aria-pressed="true" disabled=""/);
    expect(html).toContain(t.themeLocked);
    expect(html).toContain('>20</output>');
    expect(html).toMatch(new RegExp(`aria-label="${t.lengthLess}" disabled=""`));
    // The 5 and 10 presets are below its length.
    expect(html.match(/<button type="button" class="chip" aria-pressed="false" disabled="">/g)).toHaveLength(2);
    expect(html).toContain('value="Deep dive"');
    expect(html).toContain(`It is 20 books now`);
  });
});

describe('which custom journeys show', () => {
  it('archived ones are hidden from the gallery and posters, except the one a reader is on; oldest first', () => {
    const a = custom({ name: 'A' });
    const b = custom({ name: 'B', archived_at: '2026-02-01T00:00:00.000Z' });
    const c = custom({ name: 'C', theme: 'ocean_deep' });
    expect(listedCustomJourneys([a, b, c]).map((j) => j.title)).toEqual(['A', 'C']);
    expect(listedCustomJourneys([a, b, c], `custom:${b.id}`).map((j) => j.title)).toEqual(['A', 'B', 'C']);
    // An archived journey still resolves for the reader on it (its history keeps the name and theme).
    expect(resolveJourney(`custom:${b.id}`, [a, b, c])).toMatchObject({ title: 'B', theme: 'rocket_through_space', archived: true });
  });

  it('posters: the eight built-ins first, then the custom ones; "All" covers both', () => {
    const list = [...POSTER_JOURNEYS, ...listedCustomJourneys([custom({ name: 'Ours' })])];
    expect(list.map((j) => j.id).slice(0, 8)).toEqual(POSTER_JOURNEYS.map((j) => j.id));
    expect(list.at(-1)).toMatchObject({ title: 'Ours', isCustom: true });
    expect(list).toHaveLength(9);
  });
});

describe('poster titles of any length', () => {
  it('every built-in title is unchanged: one line at the full size', () => {
    for (const j of POSTER_JOURNEYS) expect(fitPosterTitle(j.title)).toEqual({ size: POSTER_TYPE.titleSize, lines: [{ text: j.title, y: POSTER_TYPE.titleY, squeeze: false }] });
  });

  it('a longer name shrinks, then breaks onto two lines; nothing is wider than the page inside the safe margin', () => {
    expect(fitPosterTitle('x'.repeat(30)).lines).toHaveLength(1);
    const words = 'The great big summer reading adventure with all of my favourite books from the library!!';
    const two = fitPosterTitle(words);
    expect(two.lines).toHaveLength(2);
    expect(two.lines.map((l) => l.text).join(' ')).toBe(words);
    const hundred = fitPosterTitle('A'.repeat(100));
    expect(hundred.lines.map((l) => l.text.length)).toEqual([50, 50]);
    for (const title of [two, hundred]) {
      for (const line of title.lines) {
        expect(line.squeeze || line.text.length * 0.6 * title.size <= TITLE_WIDTH).toBe(true);
        expect(line.y).toBeLessThan(POSTER_TYPE.captionY - POSTER_TYPE.captionSize);
      }
    }
    expect(TITLE_WIDTH).toBeLessThan(POSTER_FRAME.width - 2 * POSTER_FRAME.margin);
  });

  it('a 100-character name on a poster: two title lines, squeezed to the safe width where needed', () => {
    const name = `${'Wonderful '.repeat(9)}Wonderful`.slice(0, 100);
    const svg = renderToStaticMarkup(createElement(JourneyPoster, { journey: customJourneyDefinition(custom({ name, steps: 3 }))! }));
    const titles = svg.match(/<text class="poster__title"[^>]*>[^<]*<\/text>/g) ?? [];
    expect(titles).toHaveLength(2);
    for (const tag of titles) {
      const length = tag.match(/textLength="([\d.]+)"/)?.[1];
      if (length) expect(Number(length)).toBeCloseTo(TITLE_WIDTH, 1);
    }
    expect(svg.match(/<circle /g)).toHaveLength(3);
  });
});

describe('a custom journey looks like its theme', () => {
  it('Ocean Deep at 3, 10 and 30 books goes down, with its scaled stages and the theme’s emoji and colour', () => {
    const deep = getJourney('ocean_deep')!;
    for (const steps of [3, 10, 30]) {
      const j = customJourneyDefinition(custom({ theme: 'ocean_deep', steps }))!;
      expect(j).toMatchObject({ direction: 'down', emoji: deep.emoji, colorVar: deep.colorVar, steps, title: `Ocean Deep · ${steps} books` });
      expect(j.stages.at(-1)).toEqual({ step: steps, label: deep.stages.at(-1)!.label });
    }
  });
});
