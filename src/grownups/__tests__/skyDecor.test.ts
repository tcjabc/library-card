import { readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../../strings';
import { DECOR_CHOICES, STACK_DECOR_KEY, readStackDecor, writeStackDecor } from '../../staircase/decorSetting';
import type { Decor } from '../../staircase/drawBudget';
import { isAppStorageKey } from '../helpers';
import { SkyDecorChoices } from '../tabs/SkyDecorSection';

// Grown-ups → Settings → "Sky decoration" (src/grownups/tabs/SkyDecorSection.tsx). Tests run in
// Node (no DOM), so this checks the rendered markup and calls the buttons' handlers directly.

const t = strings.grownups.settings;
const render = (value: Decor) => renderToStaticMarkup(createElement(SkyDecorChoices, { value, onChange: () => {}, labelledBy: 'sky' }));

describe('Sky decoration: three big choices', () => {
  it('shows Full, Reduced and None in that order, each with its hint, as a group named by the heading', () => {
    const html = render('full');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="sky"');
    const titles = [...html.matchAll(/class="choice__title">([^<]*)</g)].map((m) => m[1]);
    expect(titles).toEqual([t.skyFull, t.skyReduced, t.skyNone]);
    const details = [...html.matchAll(/class="choice__detail">([^<]*)</g)].map((m) => m[1]);
    expect(details).toEqual([t.skyFullDetail, t.skyReducedDetail, t.skyNoneDetail].map((d) => d.replace(/'/g, '&#x27;')));
    expect(DECOR_CHOICES).toEqual(['full', 'reduced', 'none']);
  });

  it('marks the current value as pressed, and only that one', () => {
    for (const value of DECOR_CHOICES) {
      const pressed = [...render(value).matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1]);
      expect(pressed).toEqual(DECOR_CHOICES.map((level) => String(level === value)));
    }
  });

  it('every choice is a "choice" button: a full grown-up tap target (44 px)', () => {
    const html = render('reduced');
    expect([...html.matchAll(/<button type="button" class="choice"/g)]).toHaveLength(3);
    const base = readFileSync(new URL('../../ui/base.css', import.meta.url), 'utf8');
    const grownups = readFileSync(new URL('../grownups.css', import.meta.url), 'utf8');
    const theme = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
    expect(base).toMatch(/\.choice \{[^}]*min-height: var\(--tap-target\);/);
    expect(grownups).toMatch(/--tap-target: var\(--tap-target-grownup\);/);
    expect(theme).toMatch(/--tap-target-grownup: 2\.75rem;/);
    expect(2.75 * 16).toBe(44);
  });

  it('each button chooses its own level', () => {
    const onChange = vi.fn();
    const group = SkyDecorChoices({ value: 'full', onChange }) as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    const buttons = group.props.children;
    expect(buttons.every((b) => isValidElement(b))).toBe(true);
    buttons.forEach((b) => b.props.onClick());
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['full', 'reduced', 'none']);
  });
});

describe('the setting it writes: library-card:stack-decor, this device only', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fakeStorage = () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
    return store;
  };

  it('writes the key, reads it back, and Full (the default) leaves nothing stored', () => {
    const store = fakeStorage();
    expect(readStackDecor()).toBe('full');
    writeStackDecor('reduced');
    expect(store.get(STACK_DECOR_KEY)).toBe('reduced');
    expect(readStackDecor()).toBe('reduced');
    writeStackDecor('none');
    expect(readStackDecor()).toBe('none');
    writeStackDecor('full');
    expect(store.has(STACK_DECOR_KEY)).toBe(false);
    expect(readStackDecor()).toBe('full');
  });

  it('is one of the keys "Reset this device" clears (the app prefix), and the same key as the developer tools use', () => {
    expect(STACK_DECOR_KEY).toBe('library-card:stack-decor');
    expect(isAppStorageKey(STACK_DECOR_KEY)).toBe(true);
  });
});
