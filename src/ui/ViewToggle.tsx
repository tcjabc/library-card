import type { ViewChoice } from '../lib/viewChoice';
import { strings } from '../strings';

interface ViewToggleProps {
  view: ViewChoice;
  onChange: (view: ViewChoice) => void;
  /** What the group is called (default "Show books as"). */
  label?: string;
  /** The grown-up size: a small pair that sits in a section heading row. */
  dense?: boolean;
}

/** Grid / List, each with an icon and a label (pressed = the one showing). */
export function ViewToggle({ view, onChange, label, dense = false }: ViewToggleProps) {
  const t = strings.bookView;
  return (
    <div className={`chip-row view-toggle${dense ? ' view-toggle--dense chip-row--dense' : ''}`} role="group" aria-label={label ?? t.label}>
      <button type="button" className="chip" aria-pressed={view === 'grid'} onClick={() => onChange('grid')}>
        <span aria-hidden="true">▦</span> {t.grid}
      </button>
      <button type="button" className="chip" aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        <span aria-hidden="true">☰</span> {t.list}
      </button>
    </div>
  );
}
