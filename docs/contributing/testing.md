# Test surfaces

Five test suites, picked by **what you're testing**.

## Decision tree

| What you changed | Tests you must add / update | Tests you must run before PR |
|---|---|---|
| One helper function under `src/Scrapers/Pipeline/` | Unit test for that helper under `src/Tests/Unit/Pipeline/` | `test:unit` |
| One phase's action / extractor / planner | Unit tests + the bank-factory test | `test:unit` + `test:pipeline` |
| New bank's pipeline config | Mocked-E2E with fixtures | `test:e2e:mock` + `test:pipeline` |
| Cross-phase invariant | Integration test under `Tests/Unit/Pipeline/CrossValidation/` | `test:pipeline` |
| Public API surface (types in `Base/Interface.ts`) | Update both unit + e2e expectations | `test:unit` + `test:e2e:mock` |
| Real-bank behavior (live network) | E2eReal suite — `Tests/E2eReal/<Bank>/` | `test:e2e:real:single` (needs `.env`) |

## Each surface in detail

### Unit (`test:unit`)

- Fast, no network, no browser.
- Lives under `src/Tests/Unit/`.
- Drives helpers / actions / phases with mocked `IPipelineContext`.
- Uses `MockFactories.ts` + `MockPipelineFactories.ts` for context construction.
- ~4800 tests, ~4 minutes.

### Pipeline + coverage (`test:pipeline`)

- Same Jest config as unit, but with coverage collection + thresholds.
- Fails if statements/branches/functions/lines drop below 97/95/97/98.
- HTML report: `src/coverage/lcov-report/`.

### Mocked-E2E (`test:e2e:mock`)

- Uses pre-recorded fixtures (HAR-like JSON) under `src/Tests/E2eMocked/<Bank>/fixtures/`.
- Drives the **real pipeline** against the fixtures — no live network, no browser.
- Currently: 3 suites pass (Amex, Discount, Visa Cal), 11 skip (waiting for fixtures).

### Bank factory tests (`test:e2e-factory-tests`)

- Cross-bank Phase H pattern — `Tests/Unit/Pipeline/CrossValidation/Phases/<Phase>Factory.test.ts`.
- Parametrised: same test body runs for every bank, asserting per-phase invariants.
- Uses fixtures under `CrossValidation/Phases/Fixtures/<bank>/<phase>/*.json`.

### Real-bank E2E (`test:e2e:real`)

- Live network, real credentials in `.env`.
- Orchestrated by `scripts/run-real-suite.ts` — `WORKER_GROUPS` defines which banks run together (Amex + Isracard sequential; others parallel).
- Single bank: `npm run test:e2e:real:single -- --testPathPatterns=<Bank>`.
- Not run in CI — gates require maintainer-side creds.

## Test fixtures

Captured under `src/Tests/E2eMocked/<Bank>/fixtures/` and `Tests/Unit/Pipeline/CrossValidation/Phases/Fixtures/<bank>/`. Always **pre-redacted** via `PiiRedactor` at capture time — committing a fixture should never leak real PII.

If you need to add fixtures, use the [`SnapshotInterceptor`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Interceptors/SnapshotFrameCapture.ts) which writes redacted JSON for every captured response, then move the relevant slice into the fixture dir.

## Where the gates run

| Trigger | Suites run |
|---|---|
| `npm run test:unit` (manual) | Unit |
| `npm run test:pipeline` (manual or pre-commit) | Pipeline + coverage |
| `npm run test:e2e:mock` (CI + pre-commit) | Mocked E2E |
| Push to PR (GitHub Actions) | Everything above + canaries + dead-code + lint + biome + tsc + format + build |
| Maintainer ad-hoc (`scripts/run-real-suite.ts`) | Real-bank E2E with credentials |
