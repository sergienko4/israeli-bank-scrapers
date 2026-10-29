---
source-files:
  - .github/dependabot.yml
  - .github/workflows/dev-tooling-watch.yml
  - scripts/dev-tooling-watch.mjs
  - scripts/dev-tooling/watch.mjs
  - .github/workflows/dependabot-auto-merge.yml
---

# Dependency updates

> **Who this is for:** maintainers reviewing a Dependabot pull request, and
> anyone changing how `.github/dependabot.yml` groups updates. When a
> lint-tooling update or the watch is red, go to
> [When the watch or a lint-tooling update is red](#when-the-watch-or-a-lint-tooling-update-is-red).

Dependabot opens version updates every Monday; npm updates at 07:00 UTC,
scheduled after that day's [dev-tooling watch](#the-dev-tooling-watch). Each npm update
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

`.github/workflows/dev-tooling-watch.yml` runs every day at 03:17 UTC, and
Dependabot opens the npm updates on Monday at 07:00 UTC, so the watch normally
looks at the newest releases before every grouped update. That order is best
effort: GitHub can delay a scheduled run, or drop it under load, most often at
the top of the hour, hence the odd minute. Its job `probe` runs
`scripts/dev-tooling-watch.mjs`, which:

1. reads the `lint-tooling` patterns from `.github/dependabot.yml` and takes
   every devDependency they match;
2. finds the newest stable release with the locked major of each one, as
   Dependabot's minor and patch updates do;
3. installs those releases into `node_modules` without touching
   `package.json` or the lockfile (`npm install --no-save --ignore-scripts`),
   and checks with `npm ls` that each one is what got installed;
4. runs ESLint, the restricted-syntax guardrails, the architectural
   canaries, Prettier, both type checks, Biome and guideline coverage, every
   one of them even after a failure.

Each command gets at most 10 minutes, and all of them together 30; a command
the budget leaves no time for is not started, and one that runs out of time is
killed with `SIGKILL`, which it cannot ignore. The probe job's 45-minute
timeout leaves 15 minutes beyond that budget for checkout, Node setup and
`npm ci`. The budget starts with the probe script, so only a setup that takes
longer ends the job before the probe writes its verdict.

The verdict is `pass`, `fail`, `error` (the install or the `npm ls` check
failed, or a gate timed out, was killed or was never started, so the result
says nothing about the update) or `no-candidate` (every package is on its
newest same-major release; a newer major is not probed, see **Majors** below).
The probe runs releases no one here has reviewed, so it
holds `contents: read` only, keeps no credential, gets no token and saves no
npm cache. It writes the report to its job summary. Job `report` holds
`issues: write`, runs nothing it downloads and reads only the verdict: it
opens or edits one issue titled `Dev-tooling watch`, labelled
`dev-tooling-watch`, on `fail` or `error`, and closes it on `pass` or
`no-candidate`. It writes the issue body itself, from the checked verdict and
a link to the run. A registry outage fails the probe (exit 2) and leaves the
issue as it was.

A manual run (**Actions → Dev-tooling watch → Run workflow**) is a dry run
unless `dry_run` is cleared: the report goes to the job summary only. To run
the probe on your machine:

```bash
node scripts/dev-tooling-watch.mjs --out /tmp/dev-tooling-watch.md
npm ci   # the probe changed node_modules; this restores the locked tree
```

## When the watch or a lint-tooling update is red

1. **Read the failing gate.** Open the run the watch issue links to: its
   summary lists every gate, with the output of each failing one. The
   update's `Static checks` job lists them too: a failure no longer skips the
   gates after it.
2. **Fix forward on `main`.** Change the code so it passes the new rule, in
   an ordinary pull request. The fix must also pass the locked version, which
   it does for almost every rule: replacing a deprecated call or an unsafe
   pattern satisfies both. #673 was fixed this way: `no-deprecated` flagged
   object-literal properties in four tests, and a typed helper fixed them on
   the old typescript-eslint too.
3. **Rebase the update.** Comment `@dependabot rebase` on it. Dependabot
   rebases on its own only when the pull request conflicts, and `main`
   requires a branch to be up to date before it merges.
4. **Approve once it is green.** `main` needs one code-owner approval and
   dismisses an approval when new commits are pushed, so approve after the
   last rebase, when every check is green.

When no fix passes both versions, push it to the Dependabot branch instead.
Dependabot then stops rebasing that pull request, so bring it up to date with
GitHub's **Update branch** button rather than `@dependabot rebase`.

## What is not automatic

- **The code fix.** The watch finds a new lint failure before the update
  does; it does not write the fix. A finding `eslint --fix` cannot fix needs a
  person.
- **The approval.** `dependabot-auto-merge.yml` approves and enables
  auto-merge when a Dependabot pull request opens, but `main` requires a
  code owner's approval, and a rebase dismisses earlier approvals.
- **Releases after the watch, and late runs.** A release published between
  the watch at 03:17 UTC and Dependabot's run at 07:00 UTC is not probed
  before the update opens, nor is anything on a day GitHub delays the watch
  past 07:00 UTC or drops it.
- **Majors.** `lint-tooling` takes minor and patch updates. A major arrives
  as a pull request of its own, and the watch does not probe it.
