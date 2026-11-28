import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JourneyPoster } from '../../grownups/cards/JourneyPoster';
import { getJourney, type Journey } from '../../journeys/journeys';

// 1.24.0: the Rocket poster printed well in 1.23.0, so its markup must not change (layout, circle
// and line sizes, labels, footer, art). The hash is of the 1.23.0 poster's rendered SVG.
const ROCKET_1_23_0 = 'e590c2aaac2f84b6a682d1e552ca4c120c8199ddef7030f39b5f3fed6d6292aa';

describe('the Rocket poster', () => {
  it('renders exactly as in 1.23.0', () => {
    const svg = renderToStaticMarkup(createElement(JourneyPoster, { journey: getJourney('rocket_through_space') as Journey }));
    expect(createHash('sha256').update(svg).digest('hex')).toBe(ROCKET_1_23_0);
  });
});
