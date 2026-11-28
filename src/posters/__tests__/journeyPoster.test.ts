import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JourneyPoster } from '../../grownups/cards/JourneyPoster';
import { getJourney, type Journey } from '../../journeys/journeys';
import { fmt, strings } from '../../strings';
import { POSTER_JOURNEYS } from '../art';
import { POSTER_TYPE } from '../posterLayout';

// 1.23.0: a journey poster's markup (Node, no DOM).

const t = strings.grownups.posters;
const journey = (id: string) => getJourney(id) as Journey;
const render = (id: string) => renderToStaticMarkup(createElement(JourneyPoster, { journey: journey(id) }));
/** The y of the <text> holding exactly `label`. */
const textY = (svg: string, label: string) => Number(svg.match(new RegExp(`<text[^>]* y="([\\d.]+)"[^>]*>${label}</text>`))?.[1]);
const theme = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../grownups/cards/posters-print.css', import.meta.url), 'utf8');

describe('the journey poster', () => {
  const rocket = render('rocket_through_space');

  it('has exactly one numbered circle and writing line per book, plus the name line', () => {
    expect(rocket.match(/<circle /g)).toHaveLength(30);
    expect(rocket.match(/<line /g)).toHaveLength(31);
    for (let book = 1; book <= 30; book++) expect(rocket).toContain(`>${book}</text>`);
    expect(rocket).not.toContain('>31</text>');
  });

  it('has the title, the caption, a blank name line, START, FINISH and the footer, from en.ts', () => {
    for (const text of [journey('rocket_through_space').title, fmt(t.caption, { count: 30 }), t.name, t.start, t.finish, t.footer]) {
      expect(rocket).toContain(`>${text.replaceAll('&', '&amp;')}</text>`);
    }
    // Nothing but the label goes with the name: it stays blank for the child to write.
    expect(rocket.match(/<text[^>]*>[^<]*<\/text>/g)?.filter((tag) => tag.includes(t.name))).toEqual([expect.stringMatching(new RegExp(`>${t.name}</text>$`))]);
    expect(rocket).toContain(`aria-label="${fmt(t.posterAlt, { journey: 'Rocket Through Space', count: 30 })}"`);
  });

  it('prints no stage labels (the space is for book titles)', () => {
    for (const stage of journey('rocket_through_space').stages) expect(rocket).not.toContain(stage.label);
  });

  it('FINISH is at the top for a journey that goes up; START at the top for Ocean Deep', () => {
    expect(textY(rocket, t.finish)).toBe(POSTER_TYPE.endTopY);
    expect(textY(rocket, t.start)).toBe(POSTER_TYPE.endBottomY);
    const ocean = render('ocean_deep');
    expect(textY(ocean, t.start)).toBe(POSTER_TYPE.endTopY);
    expect(textY(ocean, t.finish)).toBe(POSTER_TYPE.endBottomY);
    expect(ocean.match(/<circle /g)).toHaveLength(5);
    // Book 1 near the top, book 5 near the bottom.
    const y = (book: number) => Number(ocean.match(new RegExp(`<text[^>]* y="([\\d.]+)"[^>]*>${book}</text>`))?.[1]);
    expect(y(1)).toBeLessThan(y(5));
  });

  it('is line art in the ink only: no colours, greys, gradients, filters, images or inline styles', () => {
    expect([...new Set(rocket.match(/ fill="[^"]*"/g))].sort()).toEqual([' fill="currentColor"', ' fill="none"']);
    expect([...new Set(rocket.match(/ stroke="[^"]*"/g))]).toEqual([' stroke="currentColor"']);
    expect(rocket).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|<image|<linearGradient|<radialGradient|<filter|<pattern| style=|opacity/i);
    // White-filled shapes (hiding lines behind them) take the paper token, the ink the ink token.
    expect(rocket).toContain('class="poster__paper"');
    expect(css).toMatch(/\.poster__paper\s*\{\s*fill: var\(--poster-paper\);/);
    expect(css).toMatch(/color: var\(--poster-ink\);/);
    expect(theme).toContain('--poster-ink: #000000;');
    expect(theme).toContain('--poster-paper: #ffffff;');
    // Defined once, outside the dark-mode block: the poster is black on white in every theme.
    expect(theme.match(/--poster-(?:ink|paper):/g)).toHaveLength(2);
    expect(theme.indexOf('--poster-ink')).toBeLessThan(theme.indexOf('@media (prefers-color-scheme: dark)'));
  });

  it('one A4 page per poster when printing, with the old page-break fallback', () => {
    expect(css).toMatch(/\.poster-sheet \{[^}]*width: var\(--print-page-width\);[^}]*height: var\(--print-page-height\);[^}]*break-after: page;[^}]*page-break-after: always;/);
  });

  describe('every poster (1.24.0: all eight)', () => {
    for (const j of POSTER_JOURNEYS) {
      it(`${j.id}: one slot per book, the start at the ${j.direction === 'down' ? 'top' : 'bottom'}, line art only, no stage labels`, () => {
        const svg = render(j.id);
        expect(svg.match(/<circle /g)).toHaveLength(j.steps);
        expect(svg.match(/<line /g)).toHaveLength(j.steps + 1);
        expect(svg).toContain(`>${j.title.replaceAll('&', '&amp;')}</text>`);
        expect(svg).toContain(`>${fmt(t.caption, { count: j.steps })}</text>`);
        const down = j.direction === 'down';
        expect(textY(svg, t.start)).toBe(down ? POSTER_TYPE.endTopY : POSTER_TYPE.endBottomY);
        expect(textY(svg, t.finish)).toBe(down ? POSTER_TYPE.endBottomY : POSTER_TYPE.endTopY);
        const y = (book: number) => Number(svg.match(new RegExp(`<text[^>]* y="([\\d.]+)"[^>]*>${book}</text>`))?.[1]);
        if (down) expect(y(1)).toBeLessThan(y(j.steps));
        else expect(y(1)).toBeGreaterThan(y(j.steps));
        for (const stage of j.stages) expect(svg).not.toContain(`>${stage.label}<`);
        expect([...new Set(svg.match(/ fill="[^"]*"/g))].sort()).toEqual([' fill="currentColor"', ' fill="none"']);
        expect([...new Set(svg.match(/ stroke="[^"]*"/g))]).toEqual([' stroke="currentColor"']);
        expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|<image|<linearGradient|<radialGradient|<filter|<pattern| style=|opacity/i);
        // The art's own text: none (only the poster's labels, title, caption, name, numbers, footer).
        expect(svg.match(/<text/g)).toHaveLength(j.steps + 6);
        // Stroke weights: the poster's own, and the thin art line only where a drawing asks for it.
        const widths = new Set(svg.match(/ stroke-width="[^"]*"/g));
        expect([...widths].every((w) => [' stroke-width="2.5"', ' stroke-width="2"', ' stroke-width="1.2"', ' stroke-width="1.5"'].includes(w)), [...widths].join()).toBe(true);
        expect(widths.has(' stroke-width="1.5"')).toBe(j.id === 'rapunzel_tower');
      });
    }
  });

  it('its strings are all in en.ts', () => {
    for (const key of ['heading', 'intro', 'pick', 'all', 'nothingPicked', 'print', 'printOne', 'printTip', 'preview', 'previewFirst', 'posterAlt', 'caption', 'name', 'start', 'finish', 'footer'] as const) {
      expect(t[key], key).toBeTruthy();
    }
    expect(t.footer).toBe('Write each book on its line when you finish it. Colour me in and decorate!');
    expect(fmt(t.caption, { count: 30 })).toBe('My reading journey: 30 books');
  });
});
