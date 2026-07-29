# AGENTS.md

Working conventions for this repo. The code layout is documented in the
Development section of README.md — read that first.

## Verify before pushing

`npm run check` (typecheck), `npm test`, `npm run lint`, and
`npm run fmt:check` must all pass. Run `npm run fmt` to apply formatting
before the final check. When a change claims an improvement, put the measured
evidence in the commit/PR body (e.g. `npm pack --dry-run` sizes, test counts) —
not adjectives.

## Branches, commits, PRs

- Never commit directly to `main`; every change lands via a PR.
- Branch names: `<type>/<short-slug>` (`feat/context-mode`, `chore/slim-npm-package`).
- Commits follow Conventional Commits: `type(scope): subject` with types
  `feat` / `fix` / `chore` / `ci` / `docs` / `refactor`. Scope is the feature
  module or area (`lang`, `translate`, `settings`, `pkg`). Subject is
  imperative, ≤72 chars; the body explains what and why.
- PR title = the eventual squash-commit title (same format). PR body: what
  changed and why, then how it was verified. Link issues with `Closes #N`.

## READMEs are bilingual twins

- `README.md` (EN) and `README.zh-CN.md` (zh) mirror each other
  section-for-section. Any edit to one must be synced to the other in the
  same PR. The zh version is written as natural Chinese, not a mechanical
  translation of the EN sentences.
- Images use absolute GitHub raw URLs (relative paths don't render on
  npmjs.com).

## Releases

1. From the latest `main`, create a branch named `chore/bump-version-X.Y.Z`.
2. Run either `npm version minor --no-git-tag-version` or
   `npm version patch --no-git-tag-version`. Commit only `package.json` and
   `package-lock.json` as `chore(pkg): bump version to X.Y.Z`, then open and
   merge the version-bump PR.
3. Update local `main` to the merged commit, then create and push its annotated
   tag: `git tag -a vX.Y.Z -m "chore(release): X.Y.Z"` followed by
   `git push origin vX.Y.Z`.
4. Run `gh release create vX.Y.Z --verify-tag --generate-notes` — publishing the
   GitHub release triggers `.github/workflows/publish.yml`, which publishes
   to npm via OIDC trusted publishing (no tokens).

Do not run `npm version` again after the bump PR is merged; the merged manifest
already contains the release version, and another minor/patch bump would advance
it to the next version.

The npm tarball is whitelisted by `files` in package.json; if you add
runtime files outside `src/`, update it and sanity-check `npm pack --dry-run`.

## Design ground rules

- `src/core.ts` stays pure: zero pi imports, no I/O — it is the unit-test
  surface (`test/core.test.ts`, run by vitest). New logic goes
  there when it doesn't need pi APIs.
- Feature modules (`llm.ts`, `grammar.ts`, `translate.ts`, `settings.ts`,
  `flashcards.ts`, `learn.ts`) keep one-way dependencies and expose minimal
  interfaces; `index.ts` stays a thin composition root.
- Match pi ecosystem conventions before inventing UX: check the built-in
  commands and `examples/extensions/` in the pi repo (local checkout:
  `/Users/mack/code/agents/pi`) for the established pattern.
