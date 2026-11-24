import { deviceSwitch } from './deviceSwitch';

/**
 * "Covers on the stack" (developer tools: the book stack page): real covers on the Family
 * Staircase's books, their colour on the spines and their picture on the top faces. On unless
 * switched off on this device (localStorage, cleared by "Reset this device"), for a device that
 * struggles to draw them.
 */

export const STACK_COVERS_KEY = 'library-card:stack-covers';

const covers = deviceSwitch(STACK_COVERS_KEY);

export const readStackCovers = covers.read;
export const writeStackCovers = covers.write;
export const useStackCovers = covers.use;
