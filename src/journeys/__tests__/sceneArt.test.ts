import { readFileSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HotAirBalloonScene from '../../screens/journeys/scenes/HotAirBalloonScene';
import LadderToTheMoonScene from '../../screens/journeys/scenes/LadderToTheMoonScene';
import OceanCliffScene from '../../screens/journeys/scenes/OceanCliffScene';
import OceanDeepScene from '../../screens/journeys/scenes/OceanDeepScene';
import RapunzelTowerScene from '../../screens/journeys/scenes/RapunzelTowerScene';
import RedwoodTreeScene from '../../screens/journeys/scenes/RedwoodTreeScene';
import RocketThroughSpaceScene from '../../screens/journeys/scenes/RocketThroughSpaceScene';
import SkyscraperScene from '../../screens/journeys/scenes/SkyscraperScene';
import { getJourney } from '../journeys';
import { MAX_LOOPS, SCENES, SCENE_LAYERS, type SceneLayer } from '../scene';

// The scenes' art (src/screens/journeys/scenes), rendered as markup (tests run in Node).

const ART: Record<string, ComponentType<{ layer: SceneLayer }>> = {
  hot_air_balloon: HotAirBalloonScene,
  ocean_deep: OceanDeepScene,
  redwood_tree: RedwoodTreeScene,
  ocean_cliff: OceanCliffScene,
  skyscraper: SkyscraperScene,
  rapunzel_tower: RapunzelTowerScene,
  ladder_to_the_moon: LadderToTheMoonScene,
  rocket_through_space: RocketThroughSpaceScene,
};

const markup = (id: string) => SCENE_LAYERS.map((layer) => renderToStaticMarkup(createElement(ART[id], { layer }))).join('');

/** The theme's tokens, light and dark, from theme.css itself. */
function themeTokens(): { light: Map<string, string>; dark: Map<string, string> } {
  const css = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const read = (text: string) => new Map([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return { light: read(css.slice(0, darkAt)), dark: read(css.slice(darkAt)) };
}

describe('the journey scenes', () => {
  it('every journey with a scene config has its art, and the reverse', () => {
    expect(Object.keys(ART).sort()).toEqual(Object.keys(SCENES).sort());
  });

  for (const id of Object.keys(ART)) {
    describe(id, () => {
      const html = markup(id);

      it(`has at most ${MAX_LOOPS} looping shapes (an old tablet keeps up)`, () => {
        const loops = (html.match(/scene-loop /g) ?? []).length;
        expect(loops).toBeGreaterThan(0);
        expect(loops).toBeLessThanOrEqual(MAX_LOOPS);
      });

      it('takes every colour from a --journey-scene-* token: no colour in the art itself', () => {
        expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(html).not.toMatch(/\b(rgb|hsl)a?\(/i);
        expect(html).not.toMatch(/fill="(?!none)/);
      });

      it('every token it uses has a light and a dark value in theme.css', () => {
        const { light, dark } = themeTokens();
        const used = new Set([...html.matchAll(/var\((--journey-scene-[\w-]+)\)/g)].map((m) => m[1]));
        expect(used.size).toBeGreaterThan(5);
        for (const token of used) {
          expect(light.has(token), `${token} (light)`).toBe(true);
          expect(dark.has(token), `${token} (dark)`).toBe(true);
        }
      });
    });
  }

  it('the scene journeys have dark values for their theme colours too, still 4.5:1 with white text', () => {
    const { light, dark } = themeTokens();
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const id of Object.keys(SCENES)) {
      const token = getJourney(id)!.colorVar;
      for (const theme of [light, dark]) {
        const value = theme.get(token)!;
        expect(value, token).toMatch(/^#[0-9a-f]{6}$/i);
        expect(1.05 / (luminance(value) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('every loop kind the art uses has its animation in journeyScene.css', () => {
    const css = readFileSync(new URL('../../screens/journeys/journeyScene.css', import.meta.url), 'utf8');
    const kinds = new Set(Object.keys(ART).flatMap((id) => [...markup(id).matchAll(/scene-loop--([\w-]+)/g)].map((m) => m[1])));
    for (const kind of kinds) expect(css, kind).toContain(`.journey-scene--loops .scene-loop--${kind}`);
  });

  it('the backing behind text and dots over a scene, and the path, have both values', () => {
    const { light, dark } = themeTokens();
    for (const token of ['--journey-scene-backing', '--journey-scene-path', '--journey-scene-faint']) {
      expect(light.has(token)).toBe(true);
      expect(dark.has(token)).toBe(true);
    }
  });
});
