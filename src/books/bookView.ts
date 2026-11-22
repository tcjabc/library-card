import { useState } from 'react';
import type { Id } from '../data';

/**
 * My Bookshelf and Library Books as a Grid (big whole covers, the default) or a List (rows with a
 * small cover), remembered per screen and per reader on this device (localStorage; the
 * library-card: prefix means "Reset this device" clears it). Grid when unset or when storage is
 * unavailable.
 */

export type BookView = 'grid' | 'list';
export type BookViewScreen = 'shelf' | 'library';

const PREFIX = 'library-card:book-view:';

export const bookViewKey = (screen: BookViewScreen, readerId: Id) => `${PREFIX}${screen}:${readerId}`;

export function getBookView(screen: BookViewScreen, readerId: Id): BookView {
  try {
    return window.localStorage.getItem(bookViewKey(screen, readerId)) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function setBookView(screen: BookViewScreen, readerId: Id, view: BookView): void {
  try {
    if (view === 'grid') window.localStorage.removeItem(bookViewKey(screen, readerId));
    else window.localStorage.setItem(bookViewKey(screen, readerId), view);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** The screen's Grid / List choice for the active reader: remembered on this device, read again when the reader changes. */
export function useBookView(screen: BookViewScreen, readerId: Id): [BookView, (view: BookView) => void] {
  const [state, setState] = useState(() => ({ readerId, view: getBookView(screen, readerId) }));
  const view = state.readerId === readerId ? state.view : getBookView(screen, readerId);
  const choose = (next: BookView) => {
    setState({ readerId, view: next });
    setBookView(screen, readerId, next);
  };
  return [view, choose];
}
