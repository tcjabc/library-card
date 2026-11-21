import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  message: string;
  /** Optional button, e.g. Undo. Pressing it also dismisses the toast. */
  action?: { label: string; onAction: () => void };
  /** Default 3000 ms; 5000 ms when there is an action. */
  durationMs?: number;
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
      timer.current = setTimeout(dismiss, options.durationMs ?? (options.action ? 5000 : 3000));
    },
    [dismiss],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div key={toast.id} className="toast" role="status">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="btn btn--accent toast__action"
                onClick={() => {
                  toast.action?.onAction();
                  dismiss();
                }}
              >
                {toast.action.label}
              </button>
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
