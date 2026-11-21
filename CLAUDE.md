# Library Card

## Git workflow

- Never commit or push unless asked. Build tasks end with `npm run build`, `npm run lint` and a report, not a commit.
- When a feature is confirmed working, commit it: one commit per tested feature or phase, with a clear message (e.g. "Phase 2: card sign-in, hub, My Bookshelf"). Fixes found during testing go in separate, smaller commits.
- Before every commit, run `git status` and check that nothing personal or secret is staged (`.env.local`, tokens, keys, photos, real names). If anything looks wrong, stop and report it instead of committing.
- Always ask before pushing. Pushing to `main` deploys to GitHub Pages, so every push is a release.
- Remote: `git@github.com-second:tcjabc/library-card.git`. Use the repo-local git identity (`.git/config`). Never change global git config.
