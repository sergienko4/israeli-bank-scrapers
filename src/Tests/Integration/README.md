# Bank Integration Tests (Mode A — static HTML + Mode B — mirror origin)

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
│   ├── LoginFormDiscovery.integration.test.ts   # Mode A drive
│   └── ...
├── Mirror/
│   └── LoginNavigation.mirror.test.ts           # Mode B drive
├── Helpers/
│   ├── FixturePage.ts
│   ├── IntegrationBrowserFixture.ts
│   └── MirrorInterceptor.ts                     # Mode B route handler
├── fixtures/
│   └── banks/
│       ├── isracard/
│       │   ├── 01-home/ main.html, frames.json, …
│       │   ├── 02-pre-login/ …
│       │   └── 03-after-flip/ …
│       └── <bank>/<step>/main.html …
├── Tools/
│   ├── CheckBankIntegrationCoverage.ts   # the gate
│   └── HarvestBankHtml.ts                # the harvester
└── README.md (this file)
```

## Two modes

| Mode                  | Source                                                                        | Use case                                                                                        |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A — static HTML**   | `fixtures/banks/<id>/<step>/main.html` loaded into a real Playwright page     | Fast, deterministic. Guards #307-class regressions inside the resolver chain.                   |
| **B — mirror origin** | Local route handler that **replays** the captured HTML at the bank's real URL | Exercises the production `page.goto(originUrl)` navigation chain without hitting the live bank. |

Both modes are wired into the gate and run sequentially after every
other test phase, immediately before the real-bank e2e happy path.
Onboarding a new pipeline bank requires fixtures + drive coverage in
**both** modes (the gate rejects half-coverage).

## How to add a new pipeline bank

1. Implement `Pipeline/Banks/<Name>/<Name>Pipeline.ts` and **export**
   `<NAME>_LOGIN: ILoginConfig`.
2. Add a row to `Banks/BankFixtureExpectations.ts` keyed by the
   canonical `bankId` (lower-first matching `CompanyTypes`).
3. Wire the bank into `BANK_LOGIN_CONFIGS` in
   `Banks/BankLoginConfigs.ts`.
4. Add a recipe to `Tools/HarvestBankHtml.ts`.
5. Harvest the fixture:

   ```
   npx tsx src/Tests/Integration/Tools/HarvestBankHtml.ts <bankId>
   ```

6. Verify the gate passes:

   ```
   npm run lint:bank-coverage
   ```

7. Run the integration tests:

   ```
   npm run test:integration:mode-a
   npm run test:integration:mode-b
   ```

## SPA banks (`requiresHydration: true`)

The captured PRE-LOGIN HTML for SPA-shell banks does **not** contain
the credential inputs (the SPA renders them via JS after navigation).
PR-A2 captures the **post-hydration** DOM snapshot via
`page.waitForLoadState('networkidle') → page.content()` instead of the
JS bundle — see `Tools/PostLoginRecipes.ts` for the per-bank
`{ kind: 'snapshot', waitForLifecycle: 'networkidle' }` steps. Once
the hydrated snapshot lands, `requiresHydration` flips to `false` in
`Banks/BankFixtureExpectations.ts` and Mode A + Mode B drive both
phases without exception.

## Operator workflow — extended capture (forthcoming in PR-A2.2)

> **PR-A2.1 status: infrastructure-only.** The harvester ships with the
> recipe schema (`Tools/RecipeStepTypes.ts`), per-bank post-login
> recipes (`Tools/PostLoginRecipes.ts`), the credential loader
> (`Tools/CredentialLoader.ts`), the network recorder
> (`Tools/NetworkResponseRecorder.ts`), and the PII redactor
> (`Tools/PiiRedactor.ts`). The CLI flag `--include-post-login` is
> **rejected with a clear error** in PR-A2.1 — it lands wired in
> PR-A2.2 once the login + post-login executors are integrated.
>
> Until PR-A2.2 merges, the only supported invocation is the pre-login
> capture (`npx tsx src/Tests/Integration/Tools/HarvestBankHtml.ts <bankId>`).
> The post-login workflow below is the **target** operator UX once
> PR-A2.2 ships.

The harvester will support **per-phase capture** (PRE-LOGIN through
DASHBOARD + first SCRAPE response) using the discriminated-union
recipe in `Tools/RecipeStepTypes.ts`. Per-bank post-login steps live
in `Tools/PostLoginRecipes.ts` and will consume credentials from
`process.env` via `Tools/CredentialLoader.ts`.

To capture the full per-phase fixture set for one bank **(PR-A2.2)**:

1. Load credentials into `process.env` (the harvester reads the
   exact env-var names already used by `src/Tests/E2eReal/`).
2. Run:

   ```
   npx tsx src/Tests/Integration/Tools/HarvestBankHtml.ts <bankId> --include-post-login
   ```

3. Every response captured by `Tools/NetworkResponseRecorder.ts` is
   PII-redacted via `Tools/PiiRedactor.ts` (Israeli IDs, phones,
   emails, IBANs, balances, bearer/JWT tokens) **before** bytes hit
   disk.
4. Commit the resulting `fixtures/banks/<bankId>/` tree. The new
   `*.response.json` files are committed alongside the HTML snapshots.

### Beinleumi OTP (PR-A2.2)

OTP banks require interactive operator presence. Set `BEINLEUMI_OTP`
in `process.env` immediately after the SMS arrives — the harvester's
`loadOtpFromEnv` helper picks it up and feeds it into the OTP step.

## The gate (pre-commit + CI)

`Tools/CheckBankIntegrationCoverage.ts` walks every pipeline-bank
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
