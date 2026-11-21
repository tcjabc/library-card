import { useEffect, useId, useRef, type ReactNode } from 'react';
import { strings } from '../strings';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal bottom sheet (centred dialog on wide screens). Mount it to open it,
 * unmount to close. Uses <dialog> for focus trapping and Escape handling.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__body">
        <header className="sheet__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn--round btn--quiet" aria-label={strings.common.close} onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
