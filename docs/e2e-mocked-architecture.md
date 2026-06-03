# E2E-Mocked Test Architecture — Inventory + Phase 7.5 Decision

> **Status:** Authored at the start of Phase 7.5 (2026-06-03) after an
> OBSERVE pass empirically reproduced the failure modes below. This is a
> **decision document**, not a how-to. It accepts two architectural
> critiques from the maintainer and pivots the plan accordingly.

## TL;DR — Two architectural critiques, accepted

| # | Critique                                                                                                                                          | Accepted action                                                                                                                                |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **`tests/snapshots/` is gitignored** (`tests/.gitignore = **/*`). Snapshots can never reach CI, so the MOCK_MODE pipeline can never validate selectors on a clean checkout. The right fix is to **co-locate snapshots with the tests that consume them** under `src/Tests/E2eMocked/fixtures/<bank>/snapshots/<phase>.html`. | **Phase 7.5 ≡ snapshot relocation + commit.** Move `tests/snapshots/<bank>/{home,pre-login,login,…}.html` to `src/Tests/E2eMocked/fixtures/<bank>/snapshots/`; update `SNAPSHOT_ROOT` in `MockInterceptorIO.ts`, `SnapshotInterceptorIO.ts`, `SnapshotFrameCapture.ts`; commit a sanitized seed snapshot per bank. |
| 2 | **Production code branches on `process.env.MOCK_MODE`** in 6 mediator files outside the interceptor itself (`AccountResolveActions.Wait`, `AuthDiscoveryActions`, `DashboardPhaseActions.final.commit`, `CreateElementMediator`, `OtpFillPhaseActions.Pre`, `OtpTriggerPhaseActions.Pre`). Production should not know that tests exist. The env-var coupling is a code smell — the right design injects a context flag at INIT time. | **Phase 7.6 ≡ MOCK_MODE production-code purge.** Replace every `process.env.MOCK_MODE` read in `src/Scrapers/**` with an `IPipelineContext.isMockMode: boolean` field set once by `InitActions` (or by the interceptor it installs). Tests configure the context, never the env. |

The original Phase 7.5 charter ("fix 33 `describe.skip` tests") was a
symptom; these two pivots are the cause. Closing #1 makes the existing
MOCK_MODE+snapshot path runnable in CI. Closing #2 removes the
test-aware code smell from production.

## Empirical evidence (this session)

### Probe A — Route-interception + static HTML for Amex
Branch `fix/e2e-mocked-foundation-amex` (reverted). HOME PRE + PRE-LOGIN PRE pass. **`LOGIN.action` hangs to a 60 s timeout** because the fixture's `<button type="submit">` triggers a native form submit that the catch-all `abort: true` route kills, leaving the page on `about:blank`. `LOGIN.POST`'s SPA-ready prelude waits for the never-arriving navigation. Adding bespoke `<script>` glue per bank could keep the pipeline moving — that's the "smart fixture" idea, deferred to a follow-up if Phase 7.5/7.6 don't suffice.

### Probe B — `MOCK_MODE=1` + existing `tests/snapshots/amex/`
`MockInterceptor` registers the context route. First two log lines:
```
mock: iframe snapshot MISS — amex/frames/32213d6f5bb0.html missing for …analytics-BegSmorr.js
mock: iframe snapshot MISS — amex/frames/35ea4093dcbd.html missing for …setupContext-CddvN-KH.js
```
**No more pipeline progress.** 90 s test timeout fires. The captured Amex snapshot pre-dates `SnapshotFrameCapture`; `tests/snapshots/amex/frames/` is empty. **`tests/.gitignore = **/*`** means even a perfect snapshot capture would still be invisible to CI — Critique #1.

### Probe C — Production-code MOCK_MODE inventory
8 production files in `src/Scrapers/**` reference `process.env.MOCK_MODE`. Two of them are the interceptor itself (acceptable — that *is* the test-mode injection point). The other six are bank-pipeline code that should not know test mode exists:
```
Pipeline/Mediator/AccountResolve/AccountResolveActions.Wait.ts
Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.ts
Pipeline/Mediator/Dashboard/DashboardPhaseActions.final.commit.ts
Pipeline/Mediator/Elements/CreateElementMediator.ts
Pipeline/Mediator/OtpFill/OtpFillPhaseActions.Pre.ts
Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.Pre.ts
```

## Phase 7.5 plan — snapshot relocation + commit (proposed)

| Step | Action                                                                                                                            | Effort     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.5.1 | Move `tests/snapshots/<bank>/**` → `src/Tests/E2eMocked/fixtures/<bank>/snapshots/<phase>.html`                                  | mechanical |
| 7.5.2 | Update `SNAPSHOT_ROOT` in `MockInterceptorIO.ts`, `SnapshotInterceptorIO.ts`, `SnapshotFrameCapture.ts` (and 2 unit-test paths) | mechanical |
| 7.5.3 | Delete the `tests/snapshots/`-targeted line from `tests/.gitignore` (or move snapshots to a tracked subdir)                     | mechanical |
| 7.5.4 | Re-capture Amex with iframes (`DUMP_SNAPSHOTS=1 npx tsx scripts/run-mock-single.ts amex` with valid creds)                       | needs creds |
| 7.5.5 | PII-sanitize the captured snapshots (one-time scrub script — masks IDs, names, balances, account numbers)                       | scripting  |
| 7.5.6 | Commit the seed snapshot for **one** bank end-to-end. Unskip that bank's `*.e2e-mocked.test.ts`. Verify green locally + CI.       | proof      |
| 7.5.7 | Repeat 7.5.4–7.5.6 for the remaining 7 banks (parallelizable, per-bank PRs).                                                     | iterative  |

The skipped tests stay skipped until each bank's seed snapshot lands.

## Phase 7.6 plan — MOCK_MODE production-code purge (proposed)

| Step | Action                                                                                                                                                              | Effort     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.6.1 | Add `isMockMode: boolean` to `IPipelineContext` (and to `IActionContext` if needed).                                                                                | tiny       |
| 7.6.2 | Set the field once in `InitActions.applyPostLaunchSetup` from the same env-var the interceptor consults — single source of truth for the duration of the run.       | tiny       |
| 7.6.3 | Replace every `process.env.MOCK_MODE === '1'` read in the 6 mediator files with a read from the context. Add a `lint` rule banning `MOCK_MODE` outside the interceptor and the tests that pin the env-var setter behavior. | medium     |
| 7.6.4 | Update `MockPhasePolicy` consumers in `BasePhase.run` similarly — phases receive the policy through context, not env.                                                | medium     |
| 7.6.5 | Promote the lint rule to a Husky gate.                                                                                                                              | tiny       |

After 7.6, the only place that reads `process.env.MOCK_MODE` is the
`MockInterceptor` IO module and its tests. Production code becomes
mode-agnostic and the maintainer's "if code knows it, it may be an
issue" critique is permanently resolved.

## The 33 skipped tests (still skipped on `main`)

| File                                          | describe.skip | it() | Notes                                                                                  |
| --------------------------------------------- | ------------: | ---: | -------------------------------------------------------------------------------------- |
| `Amex.e2e-mocked.test.ts`                     |             1 |    4 | full-scrape + 3 error-detection (WAF / InvalidPassword / ChangePassword)               |
| `ErrorScenarios.e2e-mocked.test.ts`           |             1 |    3 | reuses Amex routes                                                                     |
| `ExternalBrowser.e2e-mocked.test.ts`          |             1 |    3 | reuses Amex routes                                                                     |
| `Isracard.e2e-mocked.test.ts`                 |             1 |    3 | reuses Amex routes                                                                     |
| `OtpDetection.e2e-mocked.test.ts`             |             1 |    7 | OTP trigger variants                                                                   |
| `SelectorFallbackBasic.e2e-mocked.test.ts`    |             3 |    4 | grouped per fallback tier                                                              |
| `SelectorFallbackAdvanced.e2e-mocked.test.ts` |             3 |    3 | grouped per fallback tier                                                              |
| `SelectorFallbackElements.e2e-mocked.test.ts` |             3 |    3 | grouped per fallback tier                                                              |
| `Discount/Discount.e2e-mocked.test.ts`        |             1 |    1 | `C:/tmp/bank-html/discount/fixtures.json` (gitignored — also fixed by 7.5)             |
| `Max/Max.e2e-mocked.test.ts`                  |             1 |    1 | same shape as Discount                                                                 |
| `VisaCal/VisaCal.e2e-mocked.test.ts`          |             1 |    1 | same shape as Discount                                                                 |
| **TOTAL**                                     |        **17** |  **33** | **8 banks of snapshot capture + sanitize + commit**                                  |

## What NOT to do

- **Do not** unskip a `*.e2e-mocked.test.ts` before its bank's snapshot has been re-captured, sanitized, and committed under `src/Tests/E2eMocked/fixtures/<bank>/snapshots/`. Probe A confirmed that route-interception alone (without a smart-fixture SPA shim) cannot drive `LoginPhase.action` past a 60 s hang.
- **Do not** un-gitignore `tests/snapshots/` in place — the path itself is wrong (root of the repo, away from the tests). Move first, then commit.
- **Do not** add a new `process.env.MOCK_MODE` read in production code — Phase 7.6 will lint-forbid it.

## Files touched while investigating (all reverted on 2026-06-03)

- `src/Tests/E2eMocked/Amex.e2e-mocked.test.ts` — unskip + DRY the 4 tests onto `amexRoutes({…})`.
- `src/Tests/E2eMocked/Helpers/AmexRoutes.ts` — `IAmexRoute` interface, HOME entry, catch-all abort.
- `src/Tests/E2eMocked/fixtures/amex/home-page.html` — new HOME fixture with `WK_HOME.ENTRY` trigger.
- `src/Tests/E2eMocked/fixtures/amex/login-page.html` — full `WK_LOGIN_FORM` form.

Branch `fix/e2e-mocked-foundation-amex` ships docs only. Implementation lives in Phase 7.5/7.6 follow-up PRs.
