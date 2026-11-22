import { useId, useRef } from 'react';
import { fmt, strings } from '../strings';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

/** The books (or "No books match") after the bar on the same screen. */
const RESULTS = '.shelf-grid, .book-list, .empty-state, .returned-books';

/**
 * The kids' "Find a book" bar: a big field that filters as you type (no submit button), with a
 * big ✕ to clear it. It sticks to the top of the screen while the books scroll under it. When
 * it's focused, the page scrolls so the books start just under it (the toggles and filters go
 * under the bar), so the on-screen keyboard leaves as many results showing as it can.
 */
export function SearchBar({ value, onChange }: SearchBarProps) {
  const t = strings.bookSearch;
  const id = useId();
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const toTop = () => {
    const el = bar.current;
    if (!el) return;
    // After the keyboard starts opening (the viewport changes size).
    window.setTimeout(() => {
      const siblings = Array.from(el.parentElement?.children ?? []);
      const results = siblings.slice(siblings.indexOf(el) + 1).find((child) => child.matches(RESULTS));
      const target = results ? results.getBoundingClientRect().top - el.offsetHeight : el.getBoundingClientRect().top;
      if (target > 1) window.scrollBy({ top: target, behavior: 'smooth' });
    }, 150);
  };

  return (
    <div ref={bar} className="search-bar" role="search">
      <label htmlFor={id} className="visually-hidden">
        {t.label}
      </label>
      <span className="search-bar__icon" aria-hidden="true">
        🔍
      </span>
      <input
        ref={input}
        id={id}
        className="input search-bar__input"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={toTop}
        onKeyDown={(e) => {
          // Enter just closes the keyboard: the results are already showing.
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="btn btn--round btn--quiet search-bar__clear"
          aria-label={t.clear}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** "No books match "…"", with a big Clear search button. */
export function NoSearchMatch({ query, onClear }: { query: string; onClear: () => void }) {
  const t = strings.bookSearch;
  return (
    <div className="empty-state stack">
      <p className="kid-emoji" aria-hidden="true">
        🔍
      </p>
      <p className="kid-lead">{fmt(t.noMatch, { query: query.trim() })}</p>
      <button type="button" className="btn btn--primary search-empty__clear" onClick={onClear}>
        {t.clear}
      </button>
    </div>
  );
}
