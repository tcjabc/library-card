import { useId } from 'react';

interface ChoiceButtonProps {
  /** The main line: the button's spoken name. */
  title: string;
  /** The line of detail under it: read as the button's description, not its name. */
  detail: string;
  /** Outlined in the brand colour: the recommended choice. */
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** A big, full-width choice: a title and a line of detail (e.g. "Combine…" / "Use the household's data only"). */
export function ChoiceButton({ title, detail, primary, disabled, onClick }: ChoiceButtonProps) {
  const id = useId();
  return (
    <button
      type="button"
      className={primary ? 'choice choice--primary' : 'choice'}
      disabled={disabled}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
      onClick={onClick}
    >
      <span id={`${id}-title`} className="choice__title">
        {title}
      </span>
      <span id={`${id}-detail`} className="choice__detail">
        {detail}
      </span>
    </button>
  );
}
