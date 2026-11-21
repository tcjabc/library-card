import { defineConfig } from 'vitest/config';

// A time zone with daylight saving, so the date helpers are tested across a
// DST change. Set before the test workers start; they inherit it.
process.env.TZ = 'America/New_York';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Each file gets its own fake IndexedDB, so files can run in parallel.
    isolate: true,
  },
});
