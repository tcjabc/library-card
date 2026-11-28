import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { LaunchShelf } from '../../screens/LaunchShelf';
import { LAUNCH_BOOKS, LAUNCH_PARTS } from '../launchRule';

// 1.22.0: the launch shelf's art (src/screens/LaunchShelf.tsx, launchShelf.css), as markup (Node).

const css = readFileSync(new URL('../../screens/launchShelf.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
const darkAt = theme.indexOf('@media (prefers-color-scheme: dark)');
const read = (text: string) => new Map([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = read(theme.slice(0, darkAt));
const dark = read(theme.slice(darkAt));

const realWindow = (globalThis as { window?: unknown }).window;
afterAll(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

/** Renders the shelf as a cold start would (a stub window: splash hash, fresh session, motion on). */
function renderPlaying(): string {
  (globalThis as { window?: unknown }).window = {
    location: { hash: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    sessionStorage: { getItem: () => null, setItem() {} },
  };
  return renderToStaticMarkup(createElement(LaunchShelf));
}

describe('the launch shelf’s markup', () => {
  // Without a browser (and so on any page that isn't a cold start) it is the finished shelf.
  const still = renderToStaticMarkup(createElement(LaunchShelf));
  const playing = renderPlaying();

  it('outside a cold start: the finished shelf, nothing animating', () => {
    expect(still).toContain('launch-shelf launch-shelf--done');
    expect(still).toContain('data-launch="done"');
  });

  it('on a cold start with motion on: the full build', () => {
    expect(playing).toContain('launch-shelf launch-shelf--full');
  });

  it('is decorative: hidden from screen readers, no text, nothing to focus or tap', () => {
    for (const html of [still, playing]) {
      expect(html.startsWith('<div class="launch-shelf')).toBe(true);
      expect(html).toContain('aria-hidden="true"');
      expect(html.replace(/<[^>]+>/g, '').trim()).toBe('');
      expect(html).not.toMatch(/<(button|a|input)\b|tabindex/);
    }
    expect(css).toMatch(/\.launch-shelf \{[^}]*pointer-events: none;/);
  });

  it(`${LAUNCH_PARTS} structure parts and ${LAUNCH_BOOKS} books, at most 25 animated`, () => {
    const books = (playing.match(/class="launch-shelf__book[ "]/g) ?? []).length;
    const parts = (playing.match(/class="launch-shelf__(back|side|board)[ "]/g) ?? []).length;
    expect(books).toBe(LAUNCH_BOOKS);
    expect(parts).toBe(LAUNCH_PARTS);
    expect(books + parts).toBeLessThanOrEqual(25);
    expect((playing.match(/<[a-z]+/g) ?? []).length).toBeLessThanOrEqual(45);
  });

  it('takes every colour from a --launch-* token: no colour in the markup itself', () => {
    expect(playing).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(playing).not.toMatch(/\b(rgb|hsl)a?\(/i);
    expect(playing).toMatch(/background:var\(--launch-book-\d\)/);
  });

  it('every colour token it uses (markup and stylesheet) has a light and a dark value', () => {
    const used = new Set([...`${playing}\n${css}`.matchAll(/var\((--launch-[\w-]+)\)/g)].map((m) => m[1]));
    const colours = [...used].filter((token) => /^#|^rgba?\(/.test(light.get(token) ?? ''));
    expect(colours.length).toBeGreaterThanOrEqual(12);
    for (const token of colours) {
      expect(light.has(token), `${token} (light)`).toBe(true);
      expect(dark.has(token), `${token} (dark)`).toBe(true);
    }
    for (const token of used) expect(light.has(token), token).toBe(true);
  });

  it('each book colour keeps 3:1 or more against the shelf’s back, light and dark', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const values of [light, dark]) {
      const back = values.get('--launch-back')!;
      for (let n = 1; n <= 8; n++) expect(ratio(values.get(`--launch-book-${n}`)!, back), `--launch-book-${n}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the launch shelf’s stylesheet', () => {
  it('its keyframes animate only transform and opacity', () => {
    const frames = [...css.matchAll(/@keyframes (launch-[\w-]+) \{([\s\S]*?)\n\}/g)];
    expect(frames.map((m) => m[1]).sort()).toEqual(['launch-drop', 'launch-fade', 'launch-rise', 'launch-slide']);
    for (const [, name, body] of frames) {
      const props = new Set([...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]));
      for (const prop of props) expect(['transform', 'opacity'], `${name}: ${prop}`).toContain(prop);
    }
  });

  it('animations and will-change only while it plays (--full / --reduced); finishing just removes the class', () => {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = rule;
      if (!/\banimation:|will-change:/.test(body) || /^\s*(from|to|\d+%)/.test(selector)) continue;
      if (selector.includes('@media') || /animation: none/.test(body)) continue;
      expect(selector, selector.trim()).toMatch(/\.launch-shelf--(full|reduced) /);
      if (/\banimation:/.test(body)) expect(body, selector.trim()).toMatch(/\bbackwards\b/);
    }
  });

  it('needs nothing newer than Chrome 103 / Safari 15: no viewport units, range queries, :has(), color-mix() or individual translate', () => {
    expect(css).not.toMatch(/\d(dvh|lvh|svh|vh|vw)\b/);
    expect(css).not.toMatch(/\((width|height)\s*[<>]/);
    expect(css).not.toMatch(/:has\(|color-mix\(|^\s*(translate|scale|rotate):/m);
  });
});
