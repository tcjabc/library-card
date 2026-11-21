import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { strings } from '../strings';
import { Sheet } from '../ui/Sheet';
import { GrownUpContext } from './context';
import { ParentGate } from './ParentGate';
import { isGrownUpUnlocked, touchGrownUp, unlockGrownUp } from './session';

/** Hosts the ParentGate sheet used by requireGrownUp(). Mount once, near the app root. */
export function GrownUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ action: () => void; reason?: string; onCancel?: () => void } | null>(null);

  const requireGrownUp = useCallback((action: () => void, reason?: string, onCancel?: () => void) => {
    // Check storage now rather than trusting rendered state: the session may
    // have just expired (timers pause while a phone sleeps).
    if (isGrownUpUnlocked()) {
      touchGrownUp();
      action();
      return;
    }
    setPending({ action, reason, onCancel });
  }, []);

  const value = useMemo(() => ({ requireGrownUp }), [requireGrownUp]);

  return (
    <GrownUpContext.Provider value={value}>
      {children}
      {pending && (
        <Sheet
          title={strings.gate.title}
          onClose={() => {
            pending.onCancel?.();
            setPending(null);
          }}
        >
          <ParentGate
            reason={pending.reason}
            onPass={() => {
              unlockGrownUp();
              const { action } = pending;
              setPending(null);
              action();
            }}
            onCancel={() => {
              pending.onCancel?.();
              setPending(null);
            }}
          />
        </Sheet>
      )}
    </GrownUpContext.Provider>
  );
}
