---
source-files:
  - .github/dependabot.yml
  - .github/workflows/dev-tooling-watch.yml
  - scripts/dev-tooling-watch.mjs
  - scripts/dev-tooling/watch.mjs
---

# Dependency updates

> **Who this is for:** maintainers reviewing a Dependabot pull request, and
> anyone changing how `.github/dependabot.yml` groups updates.

Dependabot opens version updates every Monday; npm updates at 07:00 UTC, after
that day's [dev-tooling watch](#the-dev-tooling-watch) has run. Each npm update
lands in the first group it matches, so a group only claims what no earlier
group took.
Every group that overlaps a later one also lists the overlap in the later
group's `exclude-patterns`, so the split does not depend on group order.

## npm groups

| Group                     | Takes                                                                                                                   | Updates             | Why it is separate                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `camoufox`                | `@hieutran094/camoufox-js`                                                                                              | patch, minor, major | The anti-detect browser; every release goes through CI on its own                                                           |
| `playwright`              | `playwright-core`, `playwright`                                                                                         | patch, minor        | The browser-stack gate judges each bump against the pinned Camoufox tag ([Browser stack upgrade](browser-stack-upgrade.md)) |
| `typescript`              | `@typescript/native`                                                                                                    | patch, minor        | An npm alias; `typescript` (the TS 6 alias) is bumped by hand ([TypeScript compilers](typescript-compilers.md))             |
| `lint-tooling`            | `eslint`, `eslint-*`, `@eslint/*`, `typescript-eslint`, `@typescript-eslint/*`, `globals`, `prettier`, `@biomejs/biome` | minor, patch        | A minor can add or tighten a rule, which needs a code fix                                                                   |
| `dev-dependencies`        | every other dev dependency                                                                                              | minor, patch        | Inert bumps that go green together                                                                                          |
| `production-dependencies` | every other production dependency                                                                                       | patch               | A production minor arrives as its own pull request                                                                          |
| `npm-security`            | every package                                                                                                           | security updates    | One pull request for every open advisory ([Code scanning triage](code-scanning.md))                                         |

An update type a group does not list, such as a major for `lint-tooling`,
arrives as a pull request of its own.

GitHub Actions (`actions`), the CI mirror image (`docker/`) and the docs
toolchain (`mkdocs-toolchain`, pip) have one group each.

## Why lint tooling has its own group

A lint or format release changes what the gates report, not what the library
does. typescript-eslint 8.72 extended `no-deprecated` to object-literal
properties, so the weekly `dev-dependencies` pull request
([#673](https://github.com/sergienko4/israeli-bank-scrapers/pull/673)) went red,
and every inert bump in it waited for a code fix. In `lint-tooling` such a
release gets a pull request of its own, and the other dev bumps go green
without it.

`src/Tests/Unit/Pipeline/CrossValidation/DependabotToolingGrouping.test.ts`
reads the lint packages from the repository: every dev dependency
`eslint.config.mjs` imports, plus ESLint, Prettier and Biome. It fails when
one of them is not in `lint-tooling`, or is also taken by another
version-update group. A new ESLint plugin that matches no pattern fails it
until the pattern is added to both lists.

## The dev-tooling watch

`.github/workflows/dev-tooling-watch.yml` runs every day at 03:00 UTC, and
Dependabot opens the npm updates on Monday at 07:00 UTC, so the watch has
looked at the newest releases before every grouped update. Its job `probe`
runs `scripts/dev-tooling-watch.mjs`, which:

1. reads the `lint-tooling` patterns from `.github/dependabot.yml` and takes
   every devDependency they match;
2. finds the newest stable release with the locked major of each one, as
   Dependabot's minor and patch updates do;
3. installs those releases into `node_modules` without touching
   `package.json` or the lockfile (`npm install --no-save --ignore-scripts`),
   and checks with `npm ls` that each one is what got installed;
4. runs ESLint, the restricted-syntax guardrails, the architectural
   canaries, Prettier, both type checks and Biome, every one of them even
   after a failure.

The verdict is `pass`, `fail`, `error` (the install or the `npm ls` check
failed, or a gate timed out or was killed, so the result says nothing about
the update) or `no-candidate` (every package is on its newest release). The probe runs releases no one here has reviewed, so it holds
`contents: read` only, keeps no credential, gets no token and saves no npm
cache. Job `report` holds `issues: write` and runs nothing it downloads: it
opens or edits one issue labelled `dev-tooling-watch` on `fail` or `error`,
and closes it on `pass` or `no-candidate`. A registry outage fails the probe
(exit 2) and leaves the issue as it was.

A manual run (**Actions → Dev-tooling watch → Run workflow**) is a dry run
unless `dry_run` is cleared: the report goes to the job summary only. To run
the probe on your machine:

```bash
node scripts/dev-tooling-watch.mjs --out /tmp/dev-tooling-watch.md
npm ci   # the probe changed node_modules; this restores the locked tree
```
