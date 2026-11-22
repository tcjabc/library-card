import type { Id } from '../data';
import { readViewChoice, useViewChoice, writeViewChoice, type ViewChoice } from '../lib/viewChoice';

/**
 * My Bookshelf and Library Books as a Grid (big whole covers, the default) or a List (rows with a
 * small cover), remembered per screen and per reader on this device (src/lib/viewChoice.ts).
 */

export type BookView = ViewChoice;
export type BookViewScreen = 'shelf' | 'library';

export const bookViewKey = (screen: BookViewScreen, readerId: Id) => `library-card:book-view:${screen}:${readerId}`;

export const getBookView = (screen: BookViewScreen, readerId: Id): BookView => readViewChoice(bookViewKey(screen, readerId), 'grid');

export const setBookView = (screen: BookViewScreen, readerId: Id, view: BookView): void => writeViewChoice(bookViewKey(screen, readerId), view, 'grid');

/** The screen's Grid / List choice for the active reader: read again when the reader changes. */
export const useBookView = (screen: BookViewScreen, readerId: Id) => useViewChoice(bookViewKey(screen, readerId), 'grid');
