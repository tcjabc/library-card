import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Vendored sync files and the tests ported with them stay as upstream wrote them (VENDORED.md).
  { ignores: ['dist', 'dev-dist', 'node_modules', 'src/sync/vendor/**', 'src/sync/__tests__/ported/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // Feature code must go through src/data, never an adapter directly.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/data/adapters/*', '**/data/adapters', 'idb'],
              message: 'Import storage from src/data only (getDataStore).',
            },
          ],
        },
      ],
    },
  },
  {
    // The Family Staircase draws Google covers loaded without CORS (they taint the canvas):
    // pixels are read only through src/staircase/pixelGuard.ts, which refuses a tainted canvas.
    files: ['src/staircase/**/*.{ts,tsx}'],
    ignores: ['src/staircase/pixelGuard.ts', 'src/staircase/__tests__/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['getImageData', 'toDataURL', 'toBlob', 'convertToBlob'].map((property) => ({
          property,
          message: 'Read pixels only through pixelGuard.ts (readPixels / flushForTiming): a canvas may hold a picture loaded without CORS.',
        })),
      ],
    },
  },
);
