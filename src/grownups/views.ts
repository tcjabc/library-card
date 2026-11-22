import { useViewChoice, type ViewChoice } from '../lib/viewChoice';
import type { GrownUpTab } from './helpers';

/** The grown-up tabs with a Grid / List toggle, and each one's default (src/lib/viewChoice.ts). */
export const GROWN_UP_VIEW_DEFAULTS = {
  books: 'grid',
  readers: 'list',
  libraries: 'list',
  loans: 'list',
  cards: 'list',
  notes: 'list',
} as const satisfies Partial<Record<GrownUpTab | 'notes', ViewChoice>>;

export type GrownUpViewTab = keyof typeof GROWN_UP_VIEW_DEFAULTS;

/** Per tab, on this device (not per grown-up). */
export const grownUpViewKey = (tab: GrownUpViewTab) => `library-card:grownups-view:${tab}`;

export const useGrownUpView = (tab: GrownUpViewTab) => useViewChoice(grownUpViewKey(tab), GROWN_UP_VIEW_DEFAULTS[tab]);
