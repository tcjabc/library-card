import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  /** Optional button, e.g. Undo. Pressing it also dismisses the toast. */
  action?: ToastAction;
  /** A second button, e.g. "Pick a journey!", shown after `action`. */
  secondaryAction?: ToastAction;
  /** Default 3000 ms; 5000 ms with a button, 7000 ms with two. */
  durationMs?: number;
}

function defaultDuration(options: ToastOptions): number {
  const buttons = Number(!!options.action) + Number(!!options.secondaryAction);
  return buttons === 0 ? 3000 : buttons === 1 ? 5000 : 7000;
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {
  console.warn('[toast] No <ToastProvider> mounted.');
});

/** Shows one toast at a time; a new toast replaces the current one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback<ShowToast>(
    (options) => {
      clearTimeout(timer.current);
      nextId.current += 1;
      setToast({ ...options, id: nextId.current });
      timer.current = setTimeout(dismiss, options.durationMs ?? defaultDuration(options));
    },
    [dismiss],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div
            key={toast.id}
            className={toast.action && toast.secondaryAction ? 'toast toast--two-actions' : 'toast'}
            role="status"
          >
            <span className="toast__message">{toast.message}</span>
            {[toast.action, toast.secondaryAction].map(
              (action, i) =>
                action && (
                  <button
                    key={i}
                    type="button"
                    className={i === 0 ? 'btn btn--accent toast__action' : 'btn btn--primary toast__action'}
                    onClick={() => {
                      action.onAction();
                      dismiss();
                    }}
                  >
                    {action.label}
                  </button>
                ),
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ShowToast {
  return useContext(ToastContext);
}
