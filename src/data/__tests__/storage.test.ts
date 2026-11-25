import { afterEach, describe, expect, it } from 'vitest';
import { createLocalStore } from '../adapters/local';
import { CheckFailure } from '../testing/assert';
import { CHECK_ADAPTERS, createCheckContext, storageChecks, type CheckAdapter, type CheckContext } from '../testing/storageChecks';

/**
 * The shared storage checks (also run by the in-app self-test), on Node with
 * fake-indexeddb. One Vitest test per check, grouped by area.
 */

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

function context(adapter: CheckAdapter): CheckContext {
  const { ctx, cleanup } = createCheckContext(adapter);
  cleanups.push(cleanup);
  return ctx;
}

const groups = [...new Set(storageChecks.map((c) => c.group))];
// Every check runs against both adapters: "sync" must behave exactly like "local".
for (const adapter of CHECK_ADAPTERS) {
  describe(adapter, () => {
    for (const group of groups) {
      describe(group, () => {
        for (const check of storageChecks.filter((c) => c.group === group)) {
          it(check.name, async () => {
            try {
              await check.run(context(adapter));
            } catch (error) {
              // Show the check's own detail in the Vitest report.
              if (error instanceof CheckFailure && error.detail) error.message += `\n  ${error.detail}`;
              throw error;
            }
          });
        }
      });
    }
  });
}

/**
 * Every DataStore method must be exercised by a check above. Adding a method
 * without listing it here fails, as a reminder to add a check for it.
 */
describe('coverage', () => {
  it('the checks cover every method of the local store', async () => {
    const store = await createLocalStore(`lc-coverage-${Date.now()}`);
    const methods = Object.keys(store).filter((k) => typeof (store as unknown as Record<string, unknown>)[k] === 'function');
    await store.close();
    const covered = [
      // household
      'getCurrentHousehold', 'getHousehold', 'updateHousehold', 'setHouseholdPin', 'verifyHouseholdPin', 'clearHouseholdPin',
      // readers
      'createReader', 'getReader', 'getReaderByCardToken', 'listReaders', 'updateReader', 'rotateCardToken', 'deleteReader',
      'previewDeleteReader',
      // books and covers
      'getBook', 'getBooks', 'putBook', 'saveCoverImage', 'isCoverPhotoMissing',
      // collections
      'createCollection', 'getCollection', 'listCollections', 'updateCollection', 'deleteCollection', 'setBookCollection', 'setBooksCollection',
      'clearBookCollection', 'listCollectionBooks',
      // parent notes
      'listNotes', 'createNote', 'updateNote', 'deleteNote', 'reorderNotes', 'listNotesForReader', 'listNoteViews', 'markNoteSeen', 'showAgain',
      // home
      'addHomeItem', 'getHomeItem', 'listHomeItems', 'removeHomeItem',
      // libraries and loans
      'createLibrary', 'getLibrary', 'listLibraries', 'updateLibrary', 'deleteLibrary',
      'createLoan', 'getLoan', 'listLoans', 'listActiveLoans', 'listReturnedLoans', 'findActiveLoansBySticker',
      'updateLoan', 'renewLoan', 'unrenewLoan', 'returnLoan', 'unreturnLoan', 'deleteLoan',
      // library card barcodes
      'addLibraryCard', 'getLibraryCard', 'listLibraryCards', 'listHouseholdLibraryCards', 'updateLibraryCard',
      'deleteLibraryCard', 'copyLibraryCardToReaders',
      // reads
      'markRead', 'undoLatestRead', 'clearReads', 'restoreReadEvent', 'confirmRead', 'rejectRead', 'listPendingReads', 'getReadSummary', 'listReadSummaries', 'listReadEvents',
      'countReadsSince', 'countHouseholdReads', 'listHouseholdReadSummaries',
      // journeys
      'startJourney', 'getActiveJourney', 'listJourneyHistory', 'countCompletedJourneys', 'completeJourney', 'deleteReaderJourney',
      // backup and reset
      'exportBackup', 'importBackup', 'resetDevice',
      // change notifications, and local-only helpers used by the checks
      'subscribe', 'close', 'testOnlyAddHousehold',
    ];
    expect(methods.sort()).toEqual([...covered].sort());
  });
});
