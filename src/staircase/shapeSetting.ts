import { deviceSwitch } from './deviceSwitch';

/**
 * "Cover shapes" (developer tools: the book stack page): the Family Staircase's books take their
 * footprint from their cover's shape and their thickness from the book (bookShapes.ts). On unless
 * switched off on this device (localStorage, cleared by "Reset this device"); off, the books have
 * the seeded sizes they had in 1.12.0.
 */

export const STACK_SHAPES_KEY = 'library-card:stack-shapes';

const shapes = deviceSwitch(STACK_SHAPES_KEY);

export const readStackShapes = shapes.read;
export const writeStackShapes = shapes.write;
export const useStackShapes = shapes.use;
