import { deviceSwitch } from './deviceSwitch';

/**
 * "Gap around the eye-line book" (developer tools: the book stack page): the books above the
 * eye-line book lift away and the ones below drop a little (eyeGap.ts). On unless switched off
 * on this device (localStorage, cleared by "Reset this device"); off, the pile is as it was in
 * 1.10.2.
 */

export const STACK_GAP_KEY = 'library-card:stack-gap';

const gap = deviceSwitch(STACK_GAP_KEY);

export const readStackGap = gap.read;
export const writeStackGap = gap.write;
export const useStackGap = gap.use;
