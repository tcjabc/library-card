import { deviceSwitch } from './deviceSwitch';

/**
 * "Stack sounds" (Grown-ups → Settings, and the 🔊/🔇 button on the Family Staircase): the thud
 * and the little vibration when new books land on the pile. On unless switched off on this
 * device (localStorage, cleared by "Reset this device"). Muted, the books still fall, silently.
 */

export const STACK_SOUNDS_KEY = 'library-card:stack-sounds';

const sounds = deviceSwitch(STACK_SOUNDS_KEY);

export const readStackSounds = sounds.read;
export const writeStackSounds = sounds.write;
export const useStackSounds = sounds.use;
