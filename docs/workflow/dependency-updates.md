---
source-files:
  - .github/dependabot.yml
---

# Dependency updates

> **Who this is for:** maintainers reviewing a Dependabot pull request, and
> anyone changing how `.github/dependabot.yml` groups updates.

Dependabot opens version updates every Monday. Each npm update lands in the
first group it matches, so a group only claims what no earlier group took.
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
