import { createContext, useContext } from 'react';
import type { PinAction } from '../pinPolicy';

export interface PinGuard {
  /**
   * Run a PIN-guarded action (pinPolicy.ts): after the grown-ups gate if the session ended,
   * then the PIN (unless entered in the last 2 minutes), or setting a PIN first when a synced
   * household has none. Resolves once `work` has finished, or without running it if a step was
   * cancelled. Rejects if `work` fails.
   */
  runProtected(action: PinAction, work: () => Promise<void> | void): Promise<void>;
  /** Ask for the current PIN; true when it was right (and the 2-minute window starts). */
  askPin(reason: string): Promise<boolean>;
  /** Choose a new PIN (twice) and save it; true when saved. */
  chooseNewPin(options?: { title?: string; intro?: string; done?: string }): Promise<boolean>;
  /** A new PIN, then (when syncing) the 12 words to write down; true when the PIN was set. */
  setUpPin(options?: { intro?: string }): Promise<boolean>;
  /** Show the household's 12 words with the "I've written them down" step. */
  writeDownWords(words?: string | null): Promise<void>;
  /** The forgot-PIN flow (words when syncing, a 1-minute wait otherwise). */
  forgotPin(): Promise<void>;
  /** This device syncs a household (on, or removed but not yet turned off). */
  syncing: boolean;
}

export const PinGuardContext = createContext<PinGuard | null>(null);

export function usePinGuard(): PinGuard {
  const guard = useContext(PinGuardContext);
  if (!guard) throw new Error('usePinGuard needs a <PinGuardProvider> (Grown-ups).');
  return guard;
}
