import { deviceSwitch } from './deviceSwitch';

/**
 * "Clouds" (developer tools: the book stack page): the backdrop clouds behind the pile
 * (clouds.ts). On unless switched off on this device (localStorage, cleared by "Reset this
 * device"); off, the sky and ground stay as in 1.15.0.
 */

export const STACK_CLOUDS_KEY = 'library-card:stack-clouds';

const clouds = deviceSwitch(STACK_CLOUDS_KEY);

export const readStackClouds = clouds.read;
export const writeStackClouds = clouds.write;
export const useStackClouds = clouds.use;
