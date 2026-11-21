/**
 * In-app storage self-test (the developer page). Runs the same checks as the
 * Vitest suite (src/data/testing/storageChecks.ts), but in this browser's real
 * IndexedDB, against throwaway databases that are deleted afterwards. Useful
 * on real phones, where Safari's and Chrome's IndexedDB differ from the
 * fake one the Node tests use.
 *
 *   (await import('/src/data/selftest.ts')).runLocalSelfTest()        // the local adapter
 *   (await import('/src/data/selftest.ts')).runLocalSelfTest('sync')  // the sync adapter
 */
import { CheckFailure } from './testing/assert';
import { createCheckContext, storageChecks, type CheckAdapter } from './testing/storageChecks';

export interface SelfTestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export async function runLocalSelfTest(adapter: CheckAdapter = 'local'): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  for (const check of storageChecks) {
    const { ctx, cleanup } = createCheckContext(adapter);
    const name = `${check.group}: ${check.name}`;
    try {
      await check.run(ctx);
      results.push({ name, pass: true });
    } catch (error) {
      const detail =
        error instanceof CheckFailure
          ? [error.message, error.detail].filter(Boolean).join(' — ')
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
      results.push({ name, pass: false, detail });
    } finally {
      await cleanup();
    }
  }
  return results;
}
