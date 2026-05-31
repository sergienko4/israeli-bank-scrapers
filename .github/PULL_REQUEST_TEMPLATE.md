<!--
Pull Request — Israeli Bank Scrapers (Pipeline architecture)

Keep the PR small and focused. One PR == one logical change
(see pr-guidlines.md §1). Target 200–400 lines of changed code;
split larger work before review.

Commit messages follow the 50/72 rule (commit-guidlines.md).

MANDATORY sections (enforced by `.github/workflows/pr-body-check.yml`):
  - `## Guideline compliance`  — required by pr-guidlines.md §10
  - `## Why`                   — required by pr-guidlines.md §7
  - `## What`                  — required by pr-guidlines.md §7
Removing or renaming any of the three headers will FAIL the
`PR Body Compliance` check and block merge.
-->

## Guideline compliance

<!--
REQUIRED (pr-guidlines.md §10). A 15-row (or 18-row for Phase 8.5*
sub-phases) self-declaration table. Row sources MUST include
where applicable: CLEAN_CODE.md (function/file/complexity/params caps),
CLAUDE.md (ZERO CSS selectors), agent-contract.md §A3.5 (exit-gate
GREEN + timestamp), agent-contract.md §Test safety net (bodies
unchanged), spec.txt (commit-message contract), before-commit-guidlines.md
(6-step + husky 20 gates), commit-guidlines.md (Conventional
Commits + Co-authored-by trailer), Public API byte-identical at
lib/index.cjs, Coverage 97/95/97/98 preserved, `lint:canaries` count
matches status.txt declared, `madge --circular` returns zero new cycles.

Each row format: | <#> | <Guideline (source)> | ✅ <verification method> |

Use ✅ only if you can produce the verification command output.
Use ❌ + explain otherwise — ❌ row = merge blocker, fix + re-run A3.5.
-->

| # | Guideline (source) | Status | Verification |
|---|---|---|---|
|  1 |  |  |  |
|  2 |  |  |  |
|  3 |  |  |  |

## Why

<!-- Short paragraph (1–3 sentences). Explain WHY this change exists. Link issues / prior PRs if relevant. -->

## What

<!-- Short paragraph or bullet list. Describe WHAT changed (scope, files touched, commits if multi-commit). -->

-
-
-

## Test plan

<!-- Tick what applies before requesting review. -->

- [ ] unit tests added / updated
- [ ] integration tests added / updated where the surface warrants
- [ ] `npm run lint` passes
- [ ] `npm run lint:guideline-coverage` passes (asserts `eslint.config.mjs` enforces CLEAN_CODE.md caps for every Pipeline cluster this PR touches)
- [ ] `npm run lint:canaries` passes (asserts every architectural canary still fires)
- [ ] `npm run test:pipeline` passes (coverage gates respected)
- [ ] `npm run test:e2e:mock` passes (or N/A documented below)

## Docs

<!--
Every user-visible behaviour change MUST update the user guide.
TypeDoc (/api/) auto-flows from JSDoc on src/**. mkdocs (docs/**)
is hand-authored — please add or update the relevant page.
-->

- [ ] page added or updated under `docs/` for any user-visible change (new option, new error, new phase behaviour, new bank, new observability surface)
- [ ] `mkdocs.yml` nav updated when adding a new page
- [ ] JSDoc comments updated on every changed exported symbol (TypeDoc consumes these)
- [ ] N/A — explain why: <!-- e.g. "internal refactor; no user-visible surface" -->

## CI / security

- [ ] no secrets committed
- [ ] no PII or customer identifiers in code, tests, or commit messages
- [ ] new third-party action pinned by SHA (not by tag)
- [ ] new shell scripts include `set -euo pipefail`

## Notes for reviewer

<!-- Anything that helps reading the diff. Optional. -->
