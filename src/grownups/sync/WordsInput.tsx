import { useId, useRef, useState } from 'react';
import { fmt, strings } from '../../strings';
import { checkWord, enterText, suggestions } from './wordsLogic';

const t = strings.grownups.sync.join;

interface WordsInputProps {
  words: string[];
  onChange: (words: string[]) => void;
}

/**
 * Twelve numbered boxes for the household words. Suggestions from the word
 * list right under the box being typed in (above the phone keyboard); a box
 * that isn't a list word says so once you leave it (with "Did you mean…?"). Pasting the whole list into any box
 * fills the boxes from there.
 */
export function WordsInput({ words, onChange }: WordsInputProps) {
  const base = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(0);
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set());

  const focusBox = (i: number) => requestAnimationFrame(() => refs.current[i]?.focus());

  const enter = (index: number, text: string) => {
    const next = enterText(words, index, text);
    onChange(next.words);
    if (next.focus !== index) focusBox(next.focus);
  };

  const pick = (index: number, word: string) => {
    const next = [...words];
    next[index] = word;
    onChange(next);
    setLeft((s) => new Set(s).add(index));
    if (index < words.length - 1) focusBox(index + 1);
  };


  return (
    <fieldset className="stack sync-words-input">
      <legend className="field-label">{t.wordsLabel}</legend>
      <ol className="sync-words">
        {words.map((word, i) => {
          const check = checkWord(word);
          // Only once the box is left: no warnings while someone is still typing in it.
          const problem = left.has(i) && focused !== i && check.status === 'unknown' ? check : null;
          // Suggestions right under the box being typed in, so the keyboard doesn't hide them.
          const shown = focused === i ? suggestions(word) : [];
          const errorId = `${base}-e${i}`;
          return (
            <li key={i} className="sync-words__item">
              <label htmlFor={`${base}-${i}`} className="visually-hidden">
                {fmt(t.wordLabel, { n: i + 1 })}
              </label>
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                id={`${base}-${i}`}
                className="input sync-words__input"
                value={word}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errorId : undefined}
                onChange={(e) => enter(i, e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  enter(i, e.clipboardData.getData('text'));
                }}
                onFocus={() => setFocused(i)}
                onBlur={() => {
                  setFocused((f) => (f === i ? null : f));
                  setLeft((s) => new Set(s).add(i));
                }}
              />
              {shown.length > 0 && (
                <div className="chip-row sync-words__suggest" aria-label={fmt(t.wordLabel, { n: i + 1 })}>
                  {shown.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      // Keep the box focused, so the tap doesn't blur it first.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(i, s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {problem && (
                <p id={errorId} className="sync-words__problem small">
                  {problem.near ? fmt(t.near, { near: problem.near }) : t.unknown}
                  {problem.near && (
                    <button type="button" className="btn btn--small" onClick={() => pick(i, problem.near!)}>
                      {fmt(t.useNear, { near: problem.near })}
                    </button>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
