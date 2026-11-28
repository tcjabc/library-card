# Library Card

## Build

- The production CSS targets the oldest browsers we support, Chrome / Edge 103 and Safari 15 (`CSS_TARGETS`, `build.cssTarget` in `vite.config.ts`). Don't remove it: Vite's default target lets the minifier drop the `vh` fallback before every `dvh`/`lvh`/`svh` and rewrite media queries into range syntax (`width>=48rem`), which Chrome 103 ignores (1.21.1: the journey scenes were 0 px tall there).
- Write a newer viewport unit with a fallback first (`height: 100vh; height: 100lvh;`) or inside `@supports`. `src/__tests__/cssFallbacks.test.ts` builds the app and fails if a fallback or a min-/max- media query goes missing.
- The dev server doesn't minify, so check old-browser CSS on the production build (`vite preview`), not on `npm run dev`.

## Git workflow

- Never commit or push unless asked. Build tasks end with `npm run build`, `npm run lint` and a report, not a commit.
- When a feature is confirmed working, commit it: one commit per tested feature or phase, with a clear message (e.g. "Phase 2: card sign-in, hub, My Bookshelf"). Fixes found during testing go in separate, smaller commits.
- Before every commit, run `git status` and check that nothing personal or secret is staged (`.env.local`, tokens, keys, photos, real names). If anything looks wrong, stop and report it instead of committing.
- Always ask before pushing. Pushing to `main` deploys to GitHub Pages, so every push is a release.
- Versioning (`package.json` version, shown in Grown-ups → Settings → About): bump the minor version for each feature release (1.0.0 → 1.1.0) and the patch version for fixes (1.1.0 → 1.1.1), in the release commit (`npm version <x.y.z> --no-git-tag-version`).
- Remote: `git@github.com-second:tcjabc/library-card.git`. Use the repo-local git identity (`.git/config`). Never change global git config.
