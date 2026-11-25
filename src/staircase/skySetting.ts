import { deviceSwitch } from './deviceSwitch';

/**
 * "Sky" (developer tools: the book stack page): the sky behind the pile, by altitude (scenery.ts).
 * On unless switched off on this device (localStorage, cleared by "Reset this device"); off, the
 * pile stands on the page's plain background as it did in 1.14.0.
 */

export const STACK_SKY_KEY = 'library-card:stack-sky';

const sky = deviceSwitch(STACK_SKY_KEY);

export const readStackSky = sky.read;
export const writeStackSky = sky.write;
export const useStackSky = sky.use;
