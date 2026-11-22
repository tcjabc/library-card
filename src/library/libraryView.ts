import type { Id } from '../data';
import type { LibraryView } from './loans';

/**
 * The kids' Library Books filter ("Mine" / "My house"), remembered per reader on this device
 * (localStorage; the library-card: prefix means "Reset this device" clears it). Mine when unset
 * or when storage is unavailable.
 */

const PREFIX = 'library-card:library-view:';

export function getLibraryView(readerId: Id): LibraryView {
  try {
    return window.localStorage.getItem(PREFIX + readerId) === 'house' ? 'house' : 'mine';
  } catch {
    return 'mine';
  }
}

export function setLibraryView(readerId: Id, view: LibraryView): void {
  try {
    if (view === 'mine') window.localStorage.removeItem(PREFIX + readerId);
    else window.localStorage.setItem(PREFIX + readerId, view);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}
