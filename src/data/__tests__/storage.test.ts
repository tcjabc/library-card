import { afterEach, describe, expect, it } from 'vitest';
import { createLocalStore } from '../adapters/local';
import { CheckFailure } from '../testing/assert';
import { createCheckContext, storageChecks, type CheckContext } from '../testing/storageChecks';

/**
 * The shared storage checks (also run by the in-app self-test), on Node with
 * fake-indexeddb. One Vitest test per check, grouped by area.
 */

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

function context(): CheckContext {
  const { ctx, cleanup } = createCheckContext();
  cleanups.push(cleanup);
  return ctx;
}

const groups = [...new Set(storageChecks.map((c) => c.group))];
for (const group of groups) {
  describe(group, () => {
    for (const check of storageChecks.filter((c) => c.group === group)) {
      it(check.name, async () => {
        try {
          await check.run(context());
        } catch (error) {
          // Show the check's own detail in the Vitest report.
          if (error instanceof CheckFailure && error.detail) error.message += `\n  ${error.detail}`;
          throw error;
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
      'getCurrentHousehold', 'getHousehold', 'updateHousehold',
      // readers
      'createReader', 'getReader', 'getReaderByCardToken', 'listReaders', 'updateReader', 'rotateCardToken', 'deleteReader',
      // books and covers
      'getBook', 'getBooks', 'putBook', 'saveCoverImage',
      // home
      'addHomeItem', 'getHomeItem', 'listHomeItems', 'removeHomeItem',
      // libraries and loans
      'createLibrary', 'getLibrary', 'listLibraries', 'updateLibrary', 'deleteLibrary',
      'createLoan', 'getLoan', 'listLoans', 'listActiveLoans', 'listReturnedLoans', 'findActiveLoansBySticker',
      'updateLoan', 'renewLoan', 'unrenewLoan', 'returnLoan', 'unreturnLoan', 'deleteLoan',
      // reads
      'markRead', 'undoLatestRead', 'restoreReadEvent', 'getReadSummary', 'listReadSummaries', 'listReadEvents',
      'countReadsSince', 'countHouseholdReads', 'listHouseholdReadSummaries',
      // journeys
      'startJourney', 'getActiveJourney', 'listJourneyHistory', 'countCompletedJourneys', 'completeJourney', 'deleteReaderJourney',
      // change notifications, and local-only helpers used by the checks
      'subscribe', 'close', 'testOnlyAddHousehold',
    ];
    expect(methods.sort()).toEqual([...covered].sort());
  });
});
