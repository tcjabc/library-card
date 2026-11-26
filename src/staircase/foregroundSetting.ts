import { deviceSwitch } from './deviceSwitch';

/**
 * "Foreground clouds" (developer tools: the book stack page): the faint wisps drifting in front of
 * the backdrop, faster than the pile (clouds.ts, Full decor only). On unless switched off on this
 * device (localStorage, cleared by "Reset this device").
 */

export const STACK_CLOUDS_FG_KEY = 'library-card:stack-clouds-fg';

const foreground = deviceSwitch(STACK_CLOUDS_FG_KEY);

export const readStackForeground = foreground.read;
export const writeStackForeground = foreground.write;
export const useStackForeground = foreground.use;
