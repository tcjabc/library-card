import { createContext } from 'react';

export interface GrownUpGateRequest {
  /**
   * Runs `action` now if a grown-up session is unlocked, otherwise after the
   * gate is passed. `onCancel` runs if the gate is closed instead.
   */
  requireGrownUp: (action: () => void, reason?: string, onCancel?: () => void) => void;
}

export const GrownUpContext = createContext<GrownUpGateRequest>({
  requireGrownUp: () => console.warn('[grown-ups] No <GrownUpProvider> mounted.'),
});
