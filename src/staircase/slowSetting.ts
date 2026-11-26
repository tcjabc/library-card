import { deviceSwitch } from './deviceSwitch';

/**
 * "Pretend slow frames" (developer tools: the book stack page): the per-visit budget hears every
 * moving frame as at least PRETEND_SLOW_FRAME_MS long (drawBudget.budgetFrameMs), so the drop-out
 * (decor first, then resolution) can be seen on a fast device. Off unless switched on on this
 * device (localStorage, cleared by "Reset this device").
 */

export const STACK_SLOW_KEY = 'library-card:stack-slow';

const slow = deviceSwitch(STACK_SLOW_KEY, { defaultOn: false });

export const readStackSlow = slow.read;
export const writeStackSlow = slow.write;
export const useStackSlow = slow.use;
