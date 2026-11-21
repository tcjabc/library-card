import { useId } from 'react';
import { AVATARS } from './avatars';

/** Emoji avatar choice, as a row of radio buttons. */
export function AvatarPicker({ value, onChange, legend }: { value: string; onChange: (avatar: string) => void; legend: string }) {
  const name = useId();
  return (
    <fieldset className="avatar-picker">
      <legend className="field-label">{legend}</legend>
      {AVATARS.map((emoji) => (
        <label key={emoji} className="avatar-picker__option">
          <input
            type="radio"
            name={name}
            value={emoji}
            checked={value === emoji}
            onChange={() => onChange(emoji)}
            className="visually-hidden"
          />
          <span className="avatar" aria-hidden="true">
            {emoji}
          </span>
          <span className="visually-hidden">{emoji}</span>
        </label>
      ))}
    </fieldset>
  );
}
