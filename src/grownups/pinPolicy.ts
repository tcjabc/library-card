/**
 * Which grown-up actions the household PIN guards, and what to do before one runs.
 * Everything else in Grown-ups needs only the "grown-ups only" gate.
 *
 * - The household has a PIN: ask for it, unless it was entered in the last 2 minutes of this
 *   grown-up session (session.ts isPinUnlocked).
 * - No PIN and syncing: set one first (with the "write the words down" step), then go on.
 * - No PIN and not syncing (a local-only household): run as before, gate only.
 */

export const PIN_ACTIONS = [
  /** Sync devices → Add a device (shows the 12 words). */
  'addDevice',
  /** Sync devices → Turn off sync on this device. */
  'turnOffSync',
  /** Sync devices → Delete household from all devices. */
  'deleteHousehold',
  /** Settings → Reset this device. */
  'resetDevice',
  /** Settings → Restore from backup. */
  'restoreBackup',
  /** Settings → Household PIN → Change. */
  'changePin',
  /** Settings → Household PIN → Remove. */
  'removePin',
] as const;

export type PinAction = (typeof PIN_ACTIONS)[number];

export type PinStep = 'none' | 'ask' | 'setFirst';

export interface PinState {
  /** The household has a PIN. */
  hasPin: boolean;
  /** This device syncs a household (on, or removed but not yet turned off). */
  syncing: boolean;
  /** The PIN was entered in the last 2 minutes of this grown-up session. */
  unlocked: boolean;
}

export const isPinAction = (action: string): action is PinAction => (PIN_ACTIONS as readonly string[]).includes(action);

/** What has to happen before `action` runs. Any action not in PIN_ACTIONS: nothing. */
export function pinStep(action: string, { hasPin, syncing, unlocked }: PinState): PinStep {
  if (!isPinAction(action)) return 'none';
  if (hasPin) return unlocked ? 'none' : 'ask';
  // Changing or removing needs a PIN to exist; without one there is nothing to guard.
  if (action === 'changePin' || action === 'removePin') return 'none';
  return syncing ? 'setFirst' : 'none';
}
