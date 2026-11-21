import { useId, useState, type ReactNode } from 'react';
import { fmt, strings } from '../strings';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Runs on confirm; the sheet stays open (busy) until it settles. Throwing shows `errorText`. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** Red confirm button, for deletes. */
  danger?: boolean;
  /** The confirm button stays disabled until this word is typed (e.g. "RESET"). */
  typeToConfirm?: string;
  errorText?: string;
}

/** "Are you sure?" sheet: a message, Cancel and a confirm button. */
export function ConfirmSheet({ title, children, confirmLabel, onConfirm, onClose, danger, typeToConfirm, errorText }: ConfirmSheetProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch (error) {
      console.error('[confirm] action failed', error);
      setFailed(true);
    } finally {
      // Harmless if the action already closed the sheet.
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">{children}</div>
      {typeToConfirm && (
        <div className="stack">
          <label htmlFor={inputId} className="field-label">
            {fmt(strings.common.typeToConfirm, { word: typeToConfirm })}
          </label>
          <input
            id={inputId}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
      )}
      {failed && (
        <p className="alert alert--danger" role="alert">
          {errorText ?? strings.bookSheet.saveError}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className={danger ? 'btn btn--danger' : 'btn btn--primary'}
          disabled={!ready || busy}
          onClick={() => void confirm()}
        >
          {busy ? strings.common.saving : confirmLabel}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          {strings.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}
