# Bank Integration Tests (Mode A — static HTML)

Cross-bank integration coverage that fills the gap between unit tests
(mocked DOM) and live E2E (real credentials).

## What this layer guarantees

For every bank wired into the new **Pipeline** architecture
(`src/Scrapers/Pipeline/Banks/`), there is a committed static-HTML
fixture **plus** an integration test that drives the **real**
production `LoginFieldDiscovery` + `CreateElementMediator` chain
against that fixture.

If a future PR adds a pipeline bank without integration coverage, the
`bank-coverage` gate (husky pre-commit **and** CI Validate job) fails
the commit / PR with a clear remediation message.

## Directory layout

```
src/Tests/Integration/
├── Banks/
│   ├── BankFixtureExpectations.ts   # structural invariants per bank
│   ├── FixtureExpectations.ts       # row schema
│   ├── LoginFormDiscovery.integration.test.ts
│   └── ...
├── fixtures/
│   └── banks/
│       ├── isracard/
│       │   ├── 01-home/ main.html, frames.json, …
│       │   ├── 02-pre-login/ …
│       │   └── 03-after-flip/ …
│       └── <bank>/<step>/main.html …
├── tools/
│   ├── CheckBankIntegrationCoverage.ts   # the gate
│   └── HarvestBankHtml.ts                # the harvester
└── README.md (this file)
```

## Two modes

| Mode                                  | Source                                                                    | Use case                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **A — static HTML** (default, CI-run) | `fixtures/banks/<id>/<step>/main.html` loaded into a real Playwright page | Fast, deterministic, runs on every PR. Guards #307-class regressions.               |
| **B — mirror** (planned, follow-up)   | A local mock origin that **replays** the captured HTML on its real URL    | Validates the production navigation chain end-to-end without hitting the live bank. |

Mode B is a follow-up; the gate is already wired so onboarding a bank
forces Mode A coverage before merge.

## How to add a new pipeline bank

1. Implement `Pipeline/Banks/<Name>/<Name>Pipeline.ts` and **export**
   `<NAME>_LOGIN: ILoginConfig`.
2. Add a row to `Banks/BankFixtureExpectations.ts` keyed by the
   canonical `bankId` (lower-first matching `CompanyTypes`).
3. Wire the bank into `BANK_LOGIN_CONFIGS` in
   `Banks/LoginFormDiscovery.integration.test.ts`.
4. Add a recipe to `tools/HarvestBankHtml.ts`.
5. Harvest the fixture:

   ```
   npx tsx src/Tests/Integration/tools/HarvestBankHtml.ts <bankId>
   ```

6. Verify the gate passes:

   ```
   npm run lint:bank-coverage
   ```

7. Run the integration tests:

   ```
   npm run test:integration
   ```

## SPA banks (`requiresHydration: true`)

A few banks (Discount, Max, VisaCal, Mercantile, OtsarHahayal) render
the login form post-JS. The captured HTML alone is **not** sufficient
to drive `LoginFieldDiscovery`, so those expectation rows have
`requiresHydration: true` and the production-drive assertions are
skipped for them in Mode A. The harvested HTML still gates the
**structural** invariants (origin URL, page title, anchor markup
present in the shell) so we catch shell-level regressions.

Mode B will unblock production-drive coverage for SPA banks once
asset capture lands.

## The gate (pre-commit + CI)

`tools/CheckBankIntegrationCoverage.ts` walks every pipeline-bank
directory under `src/Scrapers/Pipeline/Banks/` and verifies:

- The pipeline file exports `*_LOGIN: ILoginConfig`.
- `BankFixtureExpectations.ts` has a row for the corresponding
  `bankId`.
- `fixtures/banks/<bankId>/` exists.

Legacy non-pipeline banks (Leumi, Mizrahi, Yahav, Behatsdaa,
BeyahadBishvilha) and API-direct providers (OneZero, Pepper, PayBox)
are explicitly allow-listed and exempted from the gate.

Wiring:

- **Pre-commit**: `.husky/pre-commit` → `bg_gate "bank-coverage" yes npm run lint:bank-coverage`
- **CI Validate**: `.github/workflows/pr.yml` → `Bank integration coverage gate` step

## Why this layer exists

Two production regressions slipped past unit tests in 2026-06 because
both bugs only manifest under real DOM order:

- **#307** — Isracard 2-form lobby (OTP form vs password form) — fixed
  by scoping `LoginFieldDiscovery` to the discovered form anchor.
- **#309** — Discount accessibility skip-link with same visible text
  as the real login button — fixed by `filterOutSkipLinks` in
  `CreateElementMediator`.

The static-HTML integration tests reproduce these scenarios offline so
the next regression of the same shape is caught at PR time, not in
production.
