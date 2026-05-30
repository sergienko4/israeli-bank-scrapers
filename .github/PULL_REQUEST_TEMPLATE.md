<!--
Pull Request — Israeli Bank Scrapers (Pipeline architecture)

Keep the PR small and focused. One PR == one logical change
(see C:/tmp/guidelines/pr-guidlines.md). Target 200–400 lines of
changed code; split larger work before review.

Commit messages follow the 50/72 rule
(C:/tmp/guidelines/commit-guidlines.md).
-->

## Summary

<!--
1–3 bullets. WHAT changes + WHY. Link issues / prior PRs if relevant.
-->

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
