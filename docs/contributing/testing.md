# Test surfaces

Choose tests by the behavior you changed. Run only the relevant cases locally
when needed; do not repeat full suites or checks already owned by normal hooks
and CI. The table identifies the validation surface, not a local full-suite
checklist.

## Decision tree

| What you changed                                   | Tests you must add / update                                | Validation surface                                                      |
| -------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| One helper function under `src/Scrapers/Pipeline/` | Unit test for that helper under `src/Tests/Unit/Pipeline/` | `test:unit`                                                             |
| One phase's action / extractor / planner           | Focused helper/phase tests                                 | `test:unit` + `test:pipeline`                                           |
| New bank's pipeline config                         | Mocked-E2E with fixtures                                   | `test:e2e:mock` + `test:pipeline`                                       |
| Cross-phase invariant                              | Domain test under `Tests/Unit/Pipeline/CrossValidation/`   | `test:pipeline`                                                         |
| CI workflow / release / dependency policy          | Policy gate under `src/Tests/Policy/`                      | `test:policy`                                                           |
| Timing, cleanup, or cancellation code              | Add a case to the memory regression gate                   | `test:memory`                                                           |
| Public API surface (types in `Base/Interface.ts`)  | Update both unit + e2e expectations                        | `test:unit` + `test:e2e:mock`                                           |
| Real-bank behavior (live network)                  | E2eReal suite — `Tests/E2eReal/<Bank>.e2e-real.test.ts`    | `npm test -- --testPathPatterns=E2eReal/<Bank>.e2e-real` (needs `.env`) |

## Each surface in detail

### Unit (`test:unit`)

- Fast, no network, no browser.
- Lives under `src/Tests/Unit/`.
- Drives helpers / actions / phases with mocked `IPipelineContext`.
- Uses `MockFactories.ts` + `MockPipelineFactories.ts` for context construction.
- Use the runner's current suite/test totals rather than a historical count.

### CI policy (`test:policy`)

- Asserts invariants about GitHub workflows, CI scripts, release policy and
  dependency-update configuration — the repo read as text, never the scrapers.
- Lives under `src/Tests/Policy/`; each file is a gate whose failure means
  "the guardrail drifted", so it names the file it guards in its message.
- Runs as its own Jest project (`jest.policy.config.cjs`) and is excluded from
  `test:unit`, so a product test run does not carry the CI-policy suite.
- `test:pipeline` still selects these files, which is how CI covers them.
- `src/Tests/Unit/Tools/JestProjectPartition.test.ts` (run by `test:unit`) pins
  the split between the two projects: no suite sits in both, every tracked test
  is selected unless a reviewed live or serial exclusion covers it, and the
  projects share the same transform, module resolution, setup file and time
  zone. Add a new test directory to the reviewed exclusions in that file only
  when its suites must never run unattended.

### Pipeline + coverage (`test:pipeline`)

- Same Jest config as unit, but with coverage collection + thresholds.
- Fails if statements/branches/functions/lines drop below 97/95/97/98.
- HTML report: `src/coverage/lcov-report/`.

### Mocked-E2E (`test:e2e:mock`)

- Uses pre-recorded fixtures (HAR-like JSON) under `src/Tests/E2eMocked/<Bank>/fixtures/`.
- Drives the **real pipeline** against the fixtures — no live network, no browser.
- Banks use synthetic HTTP gateways: a
  `<Bank>FetchMock.ts` stands in for `fetch`, and `ApiDirect/ApiDirectFlow.e2e-mocked.test.ts`
  runs each bank's login and scrape. One `Ring/RingFetchMock.ts` serves every issuer on the
  ring mobile gateway; `Helpers/FetchMockKit.ts` holds the plumbing the newer mocks share, and
  `Helpers/LogCapture.ts` the trace-level log capture their log suites check for leaks. The
  Visa Cal, Ring (Isracard, Amex), Max, Mizrahi, Hapoalim, Yahav, Beinleumi (with Massad, Otsar Hahayal and Pagi) and Discount suites also prove a run never
  launches a browser.
- Suite, test and skip totals are reported by the runner; use its current
  summary rather than a fixed count.

### Scraper contract (`test:e2e-factory-tests`)

- Runs `src/Tests/E2e.test.ts` for the scraper/error-handling contract.
- This surface can reach real bank URLs; do not treat it as an offline unit test.

### Real-bank E2E (`test:e2e:real`)

- Live network, real credentials in `.env`.
- Orchestrated by `scripts/run-real-suite.ts` — `WORKER_GROUPS` defines which banks run together (Amex + Isracard sequential; others parallel).
- Single bank: `npm test -- --testPathPatterns=E2eReal/<Bank>.e2e-real`.
- Window: a suite starts 180 days back (`defaultStartDate()`). A bank can opt into a `<BANK>_E2E_DAYS_BACK` override (`Tests/E2eReal/WindowOverride.ts`) capped at the history it serves — Mizrahi reads `MIZRAHI_E2E_DAYS_BACK`, a whole number from 1 to 365. A bad value fails the suite before the scraper is created, so it costs no login.
- Don't append `--testPathPatterns` to `test:e2e:real:single` or `test:e2e:mock`. Jest ORs it with the pattern the script already passes, so every suite runs instead of one — for real banks, a live login (and SMS) for every bank with credentials in `.env`. To run one mocked file, pass its path: `npm run test:e2e:mock -- --runTestsByPath src/Tests/E2eMocked/<File>.e2e-mocked.test.ts`.
- `test:e2e:real` itself does not run in CI. CI runs the happy-path suites of selected banks (Mizrahi among them) in the `e2e-real-group-*` jobs of `pr.yml`, each behind a maintainer-approved environment gate. Those jobs keep only tests named `scrapes transactions successfully…` (`--testNamePattern`), so every bank in a group matrix needs a happy-path test whose name starts that way. A suite with none would be skipped whole, and Jest would still exit 0. `E2eRealNameFilterGate.test.ts` fails the unit tests on such a suite.

### Memory regression gate (`test:memory`)

Two layers guarding against a repeat of the [#449](https://github.com/sergienko4/israeli-bank-scrapers/pull/449) OOM, both under `src/Tests/Unit/Pipeline/Mediator/Timing/`:

| Layer        | File                              | Asserts                                                                                   |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
| Mechanism    | `TimerLeakInvariants.test.ts`     | `jest.getTimerCount() === 0` after every timing operation settles — no timer stays armed. |
| Cancellation | `RaceTimeoutCancellation.test.ts` | The losing arm of a `raceTimeout` is cancelled, not abandoned.                            |

An armed timer keeps its callback closure reachable, and that retention is what leaked in #449, so the timer count is the invariant to hold.

These run inside `test:unit` / `test:pipeline` automatically, so CI covers them. `npm run test:memory` is the narrow local loop.

## Test fixtures

Store synthetic or pre-redacted HTTP fixtures beside the corresponding
mocked suite under `src/Tests/E2eMocked/`. `FORENSIC_TRACE=true` provides
request/response captures when an authorized live run is needed; keep
redaction enabled and inspect every fixture before committing it.

## Where the gates run

| Trigger                                         | Suites run                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run test:unit` (manual)                    | Unit (excludes the policy project)                                            |
| `npm run test:policy` (manual)                  | CI-policy gates under `src/Tests/Policy/`                                     |
| CI                                              | Pipeline + coverage                                                           |
| `npm run test:memory` (manual)                  | Memory regression gate (also inside Unit / Pipeline)                          |
| CI                                              | Mocked E2E                                                                    |
| Push to PR (GitHub Actions)                     | Everything above + canaries + dead-code + lint + biome + tsc + format + build |
| Maintainer ad-hoc (`scripts/run-real-suite.ts`) | Real-bank E2E with credentials                                                |
