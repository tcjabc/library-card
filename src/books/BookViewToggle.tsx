import { strings } from '../strings';
import type { BookView } from './bookView';

/** Grid / List: two big halves with an icon and a label. */
export function BookViewToggle({ view, onChange }: { view: BookView; onChange: (view: BookView) => void }) {
  const t = strings.bookView;
  return (
    <div className="chip-row view-toggle" role="group" aria-label={t.label}>
      <button type="button" className="chip" aria-pressed={view === 'grid'} onClick={() => onChange('grid')}>
        <span aria-hidden="true">▦</span> {t.grid}
      </button>
      <button type="button" className="chip" aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        <span aria-hidden="true">☰</span> {t.list}
      </button>
    </div>
  );
}
