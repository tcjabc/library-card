import { deviceSwitch } from './deviceSwitch';

/**
 * "Ground & horizon" (developer tools: the book stack page): the meadow the pile stands on, its
 * horizon and the base book's shadow (scenery.ts). On unless switched off on this device
 * (localStorage, cleared by "Reset this device"); off, there's no ground under the pile.
 */

export const STACK_GROUND_KEY = 'library-card:stack-ground';

const ground = deviceSwitch(STACK_GROUND_KEY);

export const readStackGround = ground.read;
export const writeStackGround = ground.write;
export const useStackGround = ground.use;
