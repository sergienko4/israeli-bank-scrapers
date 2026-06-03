# Phase 7 — Cross-Bank Test Diamond Consolidation Map

> **Status:** T7.0-T7.2 SHIPPED; T7.3 DROPPED; T7.4 VERIFIED NO-OP (snapshot drift); T7.5 SCOPED + DEFERRED to follow-up PR; T7.10 canary in progress.
> **Authority:** Master pipeline-decoupling plan (`C:\tmp\plans\israeli-bank-scrapers-fork\pipeline-decoupling-master-2026-05-28\`).
> **Branch:** `refactor/phase-7-foundation-integration-phases` (Phase 7a — first of two).
> **Companion canon:** `phase-7/spec.txt §1d`, `phase-7/status.txt` D8 (split-lock entry).

---

## Snapshot drift reconciliation (OBSERVE evidence)

The master plan's target ("reduce ~3233 it/test → ≤2200 fn via cross-bank `it.each(BANKS)`") was valid for its source-snapshot SHA. On current base `914201fb`, **the structural duplication class Phase 7 targeted has already been consumed by prior merged work** (Phase 2 mediator decoupling, the CrossValidation factory layer, BANK_SCENARIOS + ALL_BANK_CASES adoption).

### Evidence (reproducible against current SHA)

| Probe                                                                                                                                                                                                | Command                                                                                                                                                              | Result            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Per-bank `describe(...)` duplication anti-pattern                                                                                                                                                    | `Get-ChildItem -Recurse src\Tests -Filter *.test.ts \| Select-String -Pattern "describe\s*\(\s*['""].*\.(hapoalim\|discount\|max\|visacal\|isracard\|amex\|...)"` | **0 matches**     |
| `CompanyTypes.<Bank>` in Phases/                                                                                                                                                                     | grep for `CompanyTypes\.\w+` under `src/Tests/Unit/Pipeline/Phases`                                                                                                  | 1 hit (OneZero URL registration in `ApiDirectCallPhase.test.ts`)         |
| `CompanyTypes.<Bank>` in Infrastructure/                                                                                                                                                             | grep under `src/Tests/Unit/Pipeline/Infrastructure`                                                                                                                  | 14 hits (all in `BankLoginFixtures.ts` — shared per-bank data table, NOT duplicated test code) |
| `it.each` adoption                                                                                                                                                                                   | `Select-String -Pattern "it\.each\|describe\.each"`                                                                                                                  | 114 calls in 57 files |
| Total `it/test` calls                                                                                                                                                                                | `Select-String -Pattern "^\s*(it\|test)\s*[\(\.]"`                                                                                                                   | 4370 (vs master baseline 3233)         |

### What the 4370 tests actually are

The 4370 count is the genuine working size of the test suite, NOT inflated by per-bank duplication:

- **Phase tests** (`Phases/**`): bank-agnostic phase machinery (`createXFromConfig`, `pre/action/post/final` lifecycle).
- **Infrastructure tests** (`Infrastructure/**`): helper-coverage tests; bank-agnostic OR using shared fixture tables.
- **CrossValidation/Phases factory tests**: already cross-bank via `it.each(BANK_SCENARIOS)`.
- **Mediator tests** (`Mediator/**`, 165 files): unit tests for mediator helpers; bank-agnostic.
- **Bank-named files** (49 total): all are GENUINE per-bank cases — E2eFull/E2eMocked/E2eReal (per-bank by design), non-Pipeline legacy scrapers (Leumi/Mizrahi/Yahav/etc.), bank-specific Pipeline configs (OneZero/Pepper/PayBox), or documented EDGE CASE preserves (HapoalimDashboardEntry, BeinleumiCrossEndpointScan, SelectorFallbackXxx).

The master target was consumed by upstream work; Phase 7 therefore records **verification/no-op decisions** instead of manufacturing churn.

---

## Why split — Probe 7.4 forecast

Probe 7.4 (the canonical Phase 7 file-count forecast) was run twice against `main`:

| Run                     | Date       | Main SHA                 | Range    | Midpoint | vs 150-cap             |
| ----------------------- | ---------- | ------------------------ | -------- | -------- | ---------------------- |
| Pre-OBSERVE wide-scope  | 2026-06-03 | `3b0f66d8` (pre-PR-301)  | 131..294 | 213      | RED                    |
| Fresh post-PR-301 merge | 2026-06-03 | `a1aa36c7` (post-PR-301) | 178..193 | 185      | **RED — split LOCKED** |

The CodeRabbit 150-file PR cap is canonical (`pr-guidlines.md §12`); a 185-file midpoint mandates split into two sequenced PRs with **zero touched-file overlap**.

### Per-component breakdown (post-PR-301)

| Task             | Component                                                                 | Files        | Bucket      |
| ---------------- | ------------------------------------------------------------------------- | ------------ | ----------- |
| T7.1             | NEW factories + per-bank test runners                                     | 2 SHIPPED    | **7a**      |
| T7.2             | MOD `src/Tests/Integration/**` reshape to `it.each(BANKS)`                | 0 (NO-OP)    | **7a**      |
| ~~T7.3~~         | ~~MOD `src/Tests/E2eMocked/**` consolidation (5→2 files)~~ — **DROPPED**  | —            | —           |
| T7.4             | MOD `src/Tests/Phases/**` reshape                                         | ~35          | **7a**      |
| T7.5 **(NEW)**   | FIX `describe.skip` in 5 `src/Tests/E2eMocked/**` files → working tests   | 5            | **7a**      |
| (infra)          | NEW infra extras (`src/Tests/Helpers/`, fixtures, ESLint canary)          | ~30          | **7a**      |
| **7a sub-total** |                                                                           | **~72..77**  | **<150 ✅** |
| T7.6             | MOD `src/Tests/Flow/**` reshape                                           | 15           | **7b**      |
| T7.7             | MOD `src/Tests/Strategy/**` reshape                                       | 29           | **7b**      |
| T7.7             | MOD per-bank `src/Tests/Banks/**` reshape                                 | 13           | **7b**      |
| T7.8             | NEW Contracts                                                             | 3            | **7b**      |
| T7.9             | RES Mediator / Types / Core residue (of 197 in tree)                      | 15..30       | **7b**      |
| T7.10            | MOD canary + ESLint rule wire-up                                          | 3            | **7b**      |
| (docs)           | DOCS updates (this file + README)                                         | 2            | **7b**      |
| **7b sub-total** |                                                                           | **~80..95**  | **<150 ✅** |

Reference total of `*.test.ts` under `src/Tests/`: **474**. Both PRs land well under the 150 cap.

### Boundary justification

7a is the **foundation + Integration + Phases + E2eMocked-fix** bucket:

- T7.1 builds the factories every later commit consumes. **SHIPPED** as `bed4e26d`.
- T7.2 verified NO-OP — Integration cluster already cross-bank. **SHIPPED** as docs in `c02f8adb`.
- T7.3 **DROPPED**: the 5 `src/Tests/E2eMocked/**` per-bank files are all `describe.skip`'d (PR-206-FOLLOWUP) with non-trivial root causes (Amex/Isracard `amexRoutes()` shared route table reauthor; Discount/Max/VisaCal `fixtures.json` URL globs do not match real bank topology). Consolidating skipped tests adds no value — they would be `describe.skip`'d in the new file too. Replaced by T7.5 (FIX, below).
- T7.4 applies the factory pattern to the Phases cluster (~35 files — the largest single 7a contribution but still under the cap).
- T7.5 (NEW) **FIXES** the 5 `describe.skip` files by repairing/authoring the route fixtures so the tests actually run and pass. Honours user directive: "no skip we want to have working tests".
- Adding the infra extras (test helpers, fixtures, new canary) here keeps all "framework code" in one PR.

7b is the **application + clean-up** bucket:

- T7.6 → T7.7 reshape the larger Flow / Strategy / Banks clusters.
- T7.8 adds the small Contracts cluster.
- T7.9 prunes the residue inside Mediator / Types / Core (only the duplicated cross-bank parts; the 167..182 genuine edge-case tests in those directories stay).
- T7.10 wires up the canary so future per-bank-only tests are blocked.

The boundary is along **commit-plan sub-clusters**, not a random file-count slice. Zero file overlap: any file touched in 7a is not touched in 7b, and vice versa.

### Sequencing

1. **7a opens first** as `refactor/phase-7-foundation-integration-phases` → CI green → CR approved → merge.
2. **7b branches off the merged 7a SHA** as `refactor/phase-7-flow-strategy-banks-residue` → its diff is purely additive over the new main.
3. Neither PR ever rebases the other's commits; the dependency is strictly forward.

---

## Cross-bank STRUCTURAL principles (the diamond)

> Tests assert **flow + contract**, not **bank**. The bank is an `it.each` input row.

| Layer                      | Test style                    | Owns                                                  | Lives in                                        |
| -------------------------- | ----------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Unit                       | jest, mocked deps             | Edge cases (regex, parser branches, error paths)      | `src/Tests/Unit/**`                             |
| Integration                | jest + Playwright stubs       | Cross-bank flow contracts via `it.each(BANKS)`        | `src/Tests/Integration/**`                      |
| Mock-E2E                   | jest + recorded HTML fixtures | End-to-end flow proof per bank (cross-bank `it.each`) | `src/Tests/MockE2E/**`                          |
| Real-E2E (preserved as-is) | jest + live bank              | Smoke (Workflow A) + per-bank cooldown (Workflow B/C) | `src/Tests/RealE2E/**` (not touched by Phase 7) |

**Cross-validation** (per user direction): we use the SAME flow test with DIFFERENT bank inputs to ensure no bank-specific coupling slipped in. The expectation is "the flow behaves equivalently across banks unless the bank's contract explicitly requires deviation".

### Anti-pattern this phase eliminates

```ts
// BEFORE: per-bank duplication — same flow, different file
describe('Login.hapoalim', () => { it('logs in with valid creds', ...) });
describe('Login.discount', () => { it('logs in with valid creds', ...) });
describe('Login.max',      () => { it('logs in with valid creds', ...) });
```

```ts
// AFTER: one flow assertion, multi-bank input
describe('Login.flow', () => {
  it.each(BANKS)('logs in with valid creds [%s]', async bank => {
    const ctx = await makeMockContext(bank);
    await runLoginFlow(ctx);
    expect(ctx.session).toBeAuthenticated();
  });
});
```

The ESLint canary `test-per-bank-duplication.canary.ts` (T7.9) makes regressions a build-time error.

---

## Per-bank EDGE CASES — PRESERVED (NOT reshaped)

Per the master plan and the user's "preserve real per-bank edge cases" directive, the following tests stay as per-bank suites because the bank's contract genuinely differs from peers:

| Bank     | Suite                                            | Why it cannot collapse into `it.each(BANKS)`                                                                                              |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hapoalim | `src/Tests/Banks/Hapoalim/WafBlock.test.ts`      | WAF block detection + recovery is Hapoalim-specific (provider = Imperva). No other bank uses Imperva.                                     |
| OneZero  | `src/Tests/Banks/OneZero/OtpFlow.test.ts`        | OneZero's OTP flow has unique long-term token caching (`PAYBOX_OTP_LONG_TERM`); the assertion shape doesn't apply to OTP-on-demand banks. |
| Discount | `src/Tests/Banks/Discount/AuthDiscovery.test.ts` | Discount uses a multi-step auth-discovery contract that no other bank exposes.                                                            |

These stay verbatim; only the **truly-duplicated** per-bank tests collapse.

---

## Canary list

Per the master plan and the locked canary count of **1 new in Phase 7** (the other 5 candidates I drafted in session/files/ are deferred to Phase 9):

| Canary                                | Target rule                                                     | Land in    |
| ------------------------------------- | --------------------------------------------------------------- | ---------- |
| `test-per-bank-duplication.canary.ts` | Bans `describe('Login.<bank>',` style; demands `it.each(BANKS)` | T7.10 (7b) |

Phase-9 deferrals: max-lines-per-test, max-asserts-per-it, no-skip-without-justification, no-conditional-it, no-shared-mutable-state.

---

## What's deferred to Phase 9 (max-lines enforcement)

Phase 7 is **STRUCTURAL ONLY** (per master plan, locked decision). Phase 7 does NOT enforce:

- Max-lines-per-test (deferred to Phase 9)
- Max-asserts-per-it (deferred to Phase 9)
- Test body cyclomatic limits (deferred to Phase 9)

If a test exceeds a future Phase-9 limit AFTER Phase 7 reshape, that's fine — Phase 9 will split it. Phase 7 only changes the **shape** (per-bank → cross-bank `it.each`), not the **size**.

---

## Production-code lockdown

Per `pr-guidlines.md §11` and the new T1-INVERSE husky hook (PR #301, landed `a1aa36c7`):

- **Zero `src/Scrapers/**` diffs allowed in Phase 7a or 7b PRs.\*\*
- Exception: `src/Scrapers/Pipeline/EslintCanaries/*.canary.ts` (canary files are part of the test-rule lockdown).
- Exception: `src/Tests/**` (the very files the phase is reshaping).
- If a real production bug is discovered during reshape: STOP, open a separate `fix(prod):` PR FIRST, merge, rebase the test-only branch, then resume.
- Enforcement: husky pre-commit hook blocks any matching commit on `refactor/phase-7-*`, `refactor/phase-9-*`, `chore/test-*` branches.

---

## Per-commit forecast (7a + 7b)

| Commit                                   | Branch | Files       | Cluster                                                                                     |
| ---------------------------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------- |
| **T7.0** (this doc + initial spec stubs) | 7a     | 1           | docs                                                                                                          |
| T7.1 **SHIPPED** (`bed4e26d`)            | 7a     | 2           | NEW `src/Tests/Helpers/banks.ts` + `banks.test.ts` (canonical BANKS list)                                     |
| T7.2 **SHIPPED-NOOP** (`c02f8adb`)       | 7a     | 0 (docs)    | MOD `src/Tests/Integration/**` — verified already canonical, no diff needed                                   |
| ~~T7.3~~ **DROPPED**                     | —      | —           | ~~MOD `src/Tests/E2eMocked/**`~~ — 5 originals are all `describe.skip` (PR-206-FOLLOWUP); replaced by **T7.5** |
| T7.4 (NEXT)                              | 7a     | ~29         | MOD `src/Tests/Unit/Pipeline/Phases/**` + Infrastructure helper-coverage tests → `it.each(BANKS)`             |
| T7.5 **(NEW)**                           | 7a     | 5           | FIX 5 `describe.skip` E2eMocked files — repair/author route fixtures so tests actually run + pass             |
| (infra)                                  | 7a     | ~30         | NEW `src/Tests/Helpers/`, fixtures, ESLint canary supporting code                                             |
| **7a TOTAL**                             |        | **~72..77** | **<150 ✅**                                                                                                   |
| T7.6                                     | 7b     | 15          | MOD `src/Tests/Flow/**`                                                                                       |
| T7.7 (Strategy)                          | 7b     | 29          | MOD `src/Tests/Strategy/**`                                                                                   |
| T7.7 (per-bank)                          | 7b     | 13          | MOD per-bank `src/Tests/Banks/**` (excluding the preserved edge-case suites above)                            |
| T7.8                                     | 7b     | 3           | NEW Contracts (`src/Tests/Contracts/**`)                                                                      |
| T7.9                                     | 7b     | 15..30      | RES Mediator/Types/Core residue (only duplicated cross-bank parts; edge cases stay)                           |
| T7.10                                    | 7b     | 3           | MOD canary wire-up + ESLint rule registration                                                                 |
| (docs)                                   | 7b     | 2           | DOCS updates (this file's 7b-relevant amendments + README "running tests" section)                            |
| **7b TOTAL**                             |        | **~80..95** | **<150 ✅**                                                                                                   |

---

## OBSERVE artifacts in session

- `session/files/probe-7-4-forecast.sh` — canonical Probe 7.4 script (re-runnable).
- `session/files/probe-7-4-post-pr-301.log` — raw output of the fresh probe against main `a1aa36c7`.
- `session/files/phase-7-observe-brief-draft.md` — earlier OBSERVE-light brief.
- `session/files/t1-inverse-husky-snippet.sh` — drop-in snippet that landed as PR #301.

## Commit ladder — actual (updated as commits land)

### T7.1 SHIPPED — `test(phase-7): T7.1 — canonical BANKS list + edge invariants` (commit `bed4e26d`)

Final scope: **2 files** (slim; not the original 27-file `factory+runners` forecast):

- `src/Tests/Helpers/banks.ts` (44 LoC) — `BANKS: readonly CompanyTypes[]` (frozen view of `Object.values(CompanyTypes)`) + `BankId` type alias
- `src/Tests/Helpers/banks.test.ts` (38 LoC, 5 `it()` blocks) — enum-order match / non-empty / no-dupes / frozen / string-only invariants

**Why slim vs the 27-file T7.0 plan:**

1. **`MockFactories.ts` already exists.** `src/Tests/Unit/Pipeline/Infrastructure/MockFactories.ts` (231 LoC) already provides `makeMockContext` / `makeMockOptions` / `makeMockCredentials` / `makeMockPage` / `makeMockDescriptor` / `createMockLogger` / `MOCK_LOGIN_CONFIG`. Re-adding a `Helpers/factory.ts` would duplicate the production shape — the OOP "single canonical mock" principle says one and only one factory per shape.
2. **`BANK_SCENARIOS` already exists.** `src/Tests/Unit/Pipeline/CrossValidation/Phases/Fixtures/_BankScenarios.ts` already fixtures 7 of 19 banks (Hapoalim, Beinleumi, Discount, Amex, Isracard, Max, VisaCal). T7.4 will expand this in-situ against the specific phases being reshaped — designing a parallel `Helpers/runners.ts` upfront would over-engineer before the consuming phase tests dictate the runner contract.
3. **Canary stub is FORBIDDEN.** `src/Scrapers/Pipeline/EslintCanaries/verify.sh` §T1 hardening requires every `.canary.ts` to trigger ≥1 real ESLint rule with non-null `ruleId`. A stub canary file violates the verifier. The `test-per-bank-duplication.canary.ts` therefore lands paired with its ESLint rule in **T7.9** (7b bucket).

The slim T7.1 ships the **foundation primitive** (canonical bank list) that T7.4's per-phase reshape consumes via `it.each(BANKS)`. The `factory.ts` / `runners.ts` of the original plan are re-located to **T7.4** where they will be designed against the specific phase contracts they exercise.

### T7.2 SHIPPED-NOOP — verdict logged, **no code change** (this commit)

Inventory pass identified 2 files matching `*.integration.test.ts` under `src/Tests/`:

| File                                                                                  | Status                           | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/Tests/Unit/LeumiIntegration.test.ts`                                             | **PRESERVE**                     | Legacy bank-specific integration test for the **non-Pipeline** `Scrapers/Leumi/LeumiScraper.js`. Every assertion is Leumi-specific (Hebrew error text, Leumi API response shape `TodayTransactionsItems/HistoryTransactionsItems/BalanceDisplay`, Leumi account-ID format `123/456` → `123_456`). Cannot be cross-bank parameterised — each bank has a completely different scraper / API / DOM. **Out of T7 Pipeline scope.** |
| `src/Tests/Unit/Pipeline/Mediator/Credentials/PhoneNormalisation.integration.test.ts` | **PRESERVE — already canonical** | Already uses `it.each(BANK_CASES)` (line 169) where `BANK_CASES` enumerates only banks with declared `phoneNumberFormat` (OneZero `international-plus`, Pepper `international-flat`). This is the **canonical example** of the T7 pattern at the Pipeline layer: parameterise where the production contract varies per-bank; keep per-edge-case `it()` blocks where behaviour is bank-agnostic. No reshape would improve it.   |

**T7.2 file count: 0** (vs forecast 1). The forecast counted file matches; verification reduced this to NO-OP.

### T7.3 — **DROPPED** (was: MOD MockE2E)

Heavy-OBSERVE inventory enumerated 15 files under `src/Tests/E2eMocked/**`. Of the 5 that looked like per-bank consolidation candidates (Amex, Isracard, Discount, Max, VisaCal), **ALL 5 were already `describe.skip`'d** with documented root-cause headers (PR-206-FOLLOWUP debt):

| File                                       | Skip reason (verbatim from header)                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2eMocked/Amex.e2e-mocked.test.ts`        | Tests **time out (~256s wall)** on the mocked scrape lifecycle. Shared `amexRoutes()` needs reauthoring.                                                              |
| `E2eMocked/Isracard.e2e-mocked.test.ts`    | Same root cause family as Amex.                                                                                                                                       |
| `E2eMocked/Discount/Discount...test.ts`    | Auto-generated `fixtures.json` is a scaffold whose URL globs do NOT match Discount's real URL topology. Scraper hangs on unmocked routes; times out at 90s.           |
| `E2eMocked/Max/Max...test.ts`              | Same fixture-scaffold root cause.                                                                                                                                     |
| `E2eMocked/VisaCal/VisaCal...test.ts`      | Same fixture-scaffold root cause.                                                                                                                                     |

Consolidating skipped tests into a "shared" file simply moves dead code — they would still be `describe.skip`'d in the new file, producing zero behaviour. T7.3 is therefore **DROPPED**. The user's directive ("no skip we want to have working tests") is addressed by the new **T7.5 (FIX)** task below.

### T7.4 — VERIFIED NO-OP (snapshot drift)

Per the OBSERVE evidence at the top of this document:

- **0 per-bank `describe(...)` duplication** found anywhere in `src/Tests/`
- Phases/ tests (15 files): bank-agnostic phase machinery
- Infrastructure/ tests (74 files): bank-agnostic OR using `BankLoginFixtures.ts` shared data table
- CrossValidation/Phases factory tests (10 files): already canonical `it.each(BANK_SCENARIOS)`

The structural duplication class T7.4 was scoped to address has already been consumed by prior merged work. T7.4 ships as a VERIFIED-NO-OP decision (recorded in this document; no code commit).

If a future regression introduces the anti-pattern, the **T7.10 canary** will block it at lint-time.

### T7.5 — SCOPED + DEFERRED — FIX 5 PR-206-FOLLOWUP bank fixture skips

**Precise scope** (NOT "all describe.skip"):

| File | Skip reason | Required fix |
| --- | --- | --- |
| `E2eMocked/Amex.e2e-mocked.test.ts` | `amexRoutes()` shared route table needs reauthoring | reauthor `Helpers/AmexRoutes.ts` |
| `E2eMocked/Isracard.e2e-mocked.test.ts` | Same root cause family as Amex | same route table fix |
| `E2eMocked/Discount/Discount.e2e-mocked.test.ts` | `fixtures.json` URL globs do NOT match Discount's real URL topology | author `fixtures.json` + capture HTML |
| `E2eMocked/Max/Max.e2e-mocked.test.ts` | Same fixture-scaffold root cause | author `fixtures.json` + capture HTML |
| `E2eMocked/VisaCal/VisaCal.e2e-mocked.test.ts` | Same fixture-scaffold root cause | author `fixtures.json` + capture HTML |

**OUT OF SCOPE for T7.5** (other `describe.skip` exists but is NOT this PR's responsibility):

- `ErrorScenarios.e2e-mocked.test.ts` — different infrastructure debt
- `ExternalBrowser.e2e-mocked.test.ts` — same
- `OtpDetection.e2e-mocked.test.ts` — same
- `SelectorFallbackAdvanced.e2e-mocked.test.ts` — 3 `describe.skip` blocks
- `SelectorFallbackBasic.e2e-mocked.test.ts` — 3 `describe.skip` blocks
- `SelectorFallbackElements.e2e-mocked.test.ts` — 3 `describe.skip` blocks
- All `DESCRIBE_IF = hasCredentials ? describe : describe.skip` conditional-skip patterns (these are CORRECT — only skip when env credentials missing)
- All `it.skip` blocks

**T7.5 DEFERRED to follow-up PR** because:

1. `C:/tmp/bank-html/{discount,max,visacal}/` (the fixture root) is MISSING on current dev machine. The capture script (`npm run capture:invalid-login -- <bank>`) requires real bank credentials + IL-residential network — environment I do not control.
2. Manually inferring route tables from production scraper code (without real captures) would produce tests that pass locally but are not reviewable — violates "tests we can rely on".
3. Authoring repo-local safe fixtures (synthetic HTML responding with bank-recognizable error markup) is feasible (~4-8h per bank) but is fixture engineering, NOT structural refactor.
4. Per rubber-duck recommendation: "Split T7.5 out of Phase 7 structural work and track it as fixture debt."

**T7.5 follow-up PR scope** (separate from this Phase 7 PR):

- Open `fix/e2e-mocked-fixture-debt` branch
- Implement repo-local safe fixtures under `src/Tests/E2eMocked/fixtures/{discount,max,visacal,amex,isracard}/` (committed, synthetic HTML)
- Reauthor `Helpers/AmexRoutes.ts` against current `digital.{amex,isracard}` topology
- Un-`skip` the 5 files; verify all pass in `test:e2e:mock`
- Document the fixture authoring pattern for future banks

---

## Per-commit forecast (REVISED post-OBSERVE)

These per-bank tests stay UNCHANGED (preserve specific bank behaviour the cross-bank pattern would erase):

- **Hapoalim**: `WafChallengeInterceptor.test.ts`, `HCaptchaCheckboxSolver.test.ts` (hCaptcha WAF, `WafBlockError`, Camoufox fingerprint). _NOT_ `SafeScreenshotCiPolicy.test.ts` (false-positive — only mentions Hapoalim in comments).
- **OneZero**: `OneZeroPipeline.test.ts`, `RunStep*.test.ts` (long-term token cache, persistent device, API-direct OTP).
- **Discount**: `AccountResolveActions.test.ts` (ID-card auth, `telebank.example` URL).
- **PayBox**: `PayBoxConfig.test.ts`, `PhoneFormatter.edge.test.ts` (phoneNumber-only OTP, `phoneNumberFormat: 'international-flat'`).
- **Isracard**: `HomePopupTargetBlank.test.ts` (`target=_blank` popup-follow).
- **Pepper**: `PepperPipeline.test.ts` (`phoneNumberFormat: 'international-flat'`, sequenced OTP flow).
