import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataStore, Household } from '../../data';
import { strings } from '../../strings';
import { useSync } from '../../sync/useSync';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { pinStep, type PinAction } from '../pinPolicy';
import { isPinUnlocked, unlockPinActions } from '../session';
import { useGrownUpSession } from '../useGrownUpSession';
import { NewPin } from './NewPin';
import { PinGuardContext, type PinGuard } from './pinGuardContext';
import { PinPrompt } from './PinPrompt';
import { WriteDownWords } from './WriteDownWords';

const ForgotPin = lazy(() => import('./ForgotPin'));

const t = strings.grownups.pin;
const gate = strings.gate;

/** The gate's reason (if the grown-up session ended) for each guarded action. */
const GATE_REASONS: Record<PinAction, string> = {
  addDevice: gate.reasonSyncWords,
  turnOffSync: gate.reasonSync,
  deleteHousehold: gate.reasonSync,
  resetDevice: gate.reasonReset,
  restoreBackup: gate.reasonRestore,
  changePin: gate.reasonPin,
  removePin: gate.reasonPin,
};

/** Asked once per tab session when a synced household has no PIN. */
const NUDGED_KEY = 'library-card:pin-nudged';
let nudgedInMemory = false;

type Flow =
  | { kind: 'ask'; reason: string; done: (ok: boolean) => void }
  | { kind: 'newPin'; title: string; intro?: string; doneText: string; done: (ok: boolean) => void }
  | { kind: 'words'; words: string | null; done: () => void }
  | { kind: 'forgot'; done: () => void }
  | { kind: 'nudge'; done: () => void };

/**
 * The household PIN for the grown-up area: hosts the PIN sheets and gives screens
 * runProtected() (usePinGuard). Also asks once per session to set a PIN when this device syncs
 * a household that has none.
 */
export function PinGuardProvider({ store, household, children }: { store: DataStore; household: Household; children: ReactNode }) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const { service, status } = useSync();
  const syncing = Boolean(status && status.state !== 'off');
  const [flow, setFlow] = useState<Flow | null>(null);
  const latest = useRef({ syncing, service });
  useEffect(() => {
    latest.current = { syncing, service };
  });

  /** Open a sheet; resolves with what it ends with. */
  const open = useCallback(<T,>(make: (finish: (value: T) => void) => Flow) => {
    return new Promise<T>((resolve) => {
      const finish = (value: T) => {
        setFlow(null);
        resolve(value);
      };
      setFlow(make(finish));
    });
  }, []);

  /** Start the 2-minute window for the household's PIN as it is now. */
  const unlockNow = useCallback(async () => {
    const hash = (await store.getCurrentHousehold()).parent_pin_hash;
    if (hash) unlockPinActions(hash);
  }, [store]);

  const askPin = useCallback(
    async (reason: string) => {
      const ok = await open<boolean>((done) => ({ kind: 'ask', reason, done }));
      if (ok) await unlockNow();
      return ok;
    },
    [open, unlockNow],
  );

  const chooseNewPin = useCallback<PinGuard['chooseNewPin']>(
    async (options = {}) => {
      const ok = await open<boolean>((done) => ({
        kind: 'newPin',
        title: options.title ?? t.setTitle,
        intro: options.intro,
        doneText: options.done ?? t.saved,
        done,
      }));
      // Just chosen: the next guarded step doesn't ask for it again.
      if (ok) await unlockNow();
      return ok;
    },
    [open, unlockNow],
  );

  const writeDownWords = useCallback<PinGuard['writeDownWords']>(
    async (words) => {
      const known = words ?? null;
      const shown = open<void>((done) => ({ kind: 'words', words: known, done }));
      if (known === null) {
        // Show the sheet at once; the words follow.
        const fetched = (await latest.current.service?.recoveryWords()) ?? null;
        setFlow((f) => (f?.kind === 'words' ? { ...f, words: fetched } : f));
      }
      await shown;
    },
    [open],
  );

  const setUpPin = useCallback<PinGuard['setUpPin']>(
    async (options = {}) => {
      const sync = latest.current.syncing;
      const ok = await chooseNewPin({ intro: options.intro ?? (sync ? t.forSync : undefined) });
      if (ok && sync) await writeDownWords();
      return ok;
    },
    [chooseNewPin, writeDownWords],
  );

  const forgotPin = useCallback(() => open<void>((done) => ({ kind: 'forgot', done })), [open]);

  const runProtected = useCallback<PinGuard['runProtected']>(
    (action, work) =>
      runAsGrownUp(async () => {
        // The household now (another device may have set or changed the PIN).
        const current = await store.getCurrentHousehold();
        const step = pinStep(action, {
          hasPin: Boolean(current.parent_pin_hash),
          syncing: latest.current.syncing,
          unlocked: isPinUnlocked(current.parent_pin_hash),
        });
        if (step === 'ask' && !(await askPin(t.reasons[action]))) return;
        if (step === 'setFirst' && !(await setUpPin({ intro: t.needed }))) return;
        await work();
      }, GATE_REASONS[action]),
    [runAsGrownUp, store, askPin, setUpPin],
  );

  // A synced household without a PIN: ask once per session (the grown-up can say "Not now").
  const needsPin = syncing && status?.state !== 'deleted' && !household.parent_pin_hash;
  useEffect(() => {
    if (!needsPin || flow) return;
    try {
      if (window.sessionStorage.getItem(NUDGED_KEY)) return;
      window.sessionStorage.setItem(NUDGED_KEY, '1');
    } catch {
      // Storage blocked: ask once for this page.
      if (nudgedInMemory) return;
    }
    nudgedInMemory = true;
    void open<void>((done) => ({ kind: 'nudge', done }));
  }, [needsPin, flow, open]);

  const value: PinGuard = { runProtected, askPin, chooseNewPin, setUpPin, writeDownWords, forgotPin, syncing };

  return (
    <PinGuardContext.Provider value={value}>
      {children}
      {flow?.kind === 'ask' && (
        <Sheet title={t.promptTitle} onClose={() => flow.done(false)}>
          <PinPrompt
            store={store}
            reason={flow.reason}
            onPass={() => flow.done(true)}
            onForgot={() => {
              flow.done(false);
              void forgotPin();
            }}
          />
        </Sheet>
      )}
      {flow?.kind === 'newPin' && (
        <Sheet title={flow.title} onClose={() => flow.done(false)}>
          <NewPin
            intro={flow.intro}
            onSave={async (pin) => {
              await store.setHouseholdPin(pin);
              toast({ message: flow.doneText });
              flow.done(true);
            }}
          />
        </Sheet>
      )}
      {flow?.kind === 'words' && (
        <Sheet title={t.writeDownTitle} onClose={flow.done}>
          <WriteDownWords words={flow.words} onDone={flow.done} onHidden={flow.done} />
        </Sheet>
      )}
      {flow?.kind === 'forgot' && (
        <Sheet title={t.forgotTitle} onClose={flow.done}>
          <Suspense fallback={<p className="muted">{strings.common.loading}</p>}>
            <ForgotPin
              store={store}
              service={syncing ? service : null}
              onCancel={flow.done}
              onDone={(outcome) => {
                toast({ message: outcome === 'removed' ? t.removed : t.changed });
                if (outcome === 'changed') void unlockNow();
                flow.done();
              }}
            />
          </Suspense>
        </Sheet>
      )}
      {flow?.kind === 'nudge' && (
        <Sheet title={t.nudgeTitle} onClose={flow.done}>
          <div className="stack">
            <p>{t.nudgeBody}</p>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  flow.done();
                  void setUpPin();
                }}
              >
                {t.nudgeSet}
              </button>
              <button type="button" className="btn" onClick={flow.done}>
                {t.nudgeLater}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </PinGuardContext.Provider>
  );
}
