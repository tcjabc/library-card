import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { strings } from '../../strings';
import { GrownUpsLink } from '../GrownUpsLink';

// The "Grown-ups" link shared by the splash and the hub (src/screens/GrownUpsLink.tsx).
// Tests run in Node (no DOM), so this checks the rendered markup.

const render = (props: { className?: string } = {}) => renderToStaticMarkup(createElement(GrownUpsLink, props));

describe('GrownUpsLink', () => {
  it("is a quiet text link to #/grownups (the route shows the parent gate first), with the splash's label", () => {
    expect(render()).toBe(`<a class="link-quiet" href="#/grownups">${strings.splash.grownUps}</a>`);
  });

  it('adds a placement class after link-quiet', () => {
    expect(render({ className: 'hub__grown-ups' })).toBe(
      `<a class="link-quiet hub__grown-ups" href="#/grownups">${strings.splash.grownUps}</a>`,
    );
  });
});
