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
);
