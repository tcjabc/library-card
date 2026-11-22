import { useId } from 'react';
import { AVATARS } from './avatars';

interface AvatarPickerProps {
  /** The chosen emoji ('' for "none", when that's offered). */
  value: string;
  onChange: (avatar: string) => void;
  legend: string;
  /** Offer "none" first (a note's sticker), with this label. */
  noneLabel?: string;
}

/** Emoji choice (a reader's avatar, a note's sticker), as a row of radio buttons. */
export function AvatarPicker({ value, onChange, legend, noneLabel }: AvatarPickerProps) {
  const name = useId();
  const options = noneLabel ? ['', ...AVATARS] : [...AVATARS];
  return (
    <fieldset className="avatar-picker">
      <legend className="field-label">{legend}</legend>
      {options.map((emoji) => (
        <label key={emoji || 'none'} className="avatar-picker__option">
          <input
            type="radio"
            name={name}
            value={emoji}
            checked={value === emoji}
            onChange={() => onChange(emoji)}
            className="visually-hidden"
          />
          <span className={`avatar${emoji ? '' : ' avatar--none'}`} aria-hidden="true">
            {emoji || '∅'}
          </span>
          <span className="visually-hidden">{emoji || noneLabel}</span>
        </label>
      ))}
    </fieldset>
  );
}
