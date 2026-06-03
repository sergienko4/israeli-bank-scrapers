# Phase 7 — Cross-Bank Test Diamond Consolidation Map

> **Status:** T7.0 — split-lock + scope boundary draft (per-assertion-ID inventory to be filled in by T7.1+ as commits land).
> **Authority:** Master pipeline-decoupling plan (`C:\tmp\plans\israeli-bank-scrapers-fork\pipeline-decoupling-master-2026-05-28\`).
> **Branch:** `refactor/phase-7-foundation-integration-phases` (Phase 7a — first of two).
> **Companion canon:** `phase-7/spec.txt §1d`, `phase-7/status.txt` D8 (split-lock entry).

---

## Why split — Probe 7.4 forecast

Probe 7.4 (the canonical Phase 7 file-count forecast) was run twice against `main`:

| Run | Date | Main SHA | Range | Midpoint | vs 150-cap |
|---|---|---|---|---|---|
| Pre-OBSERVE wide-scope | 2026-06-03 | `3b0f66d8` (pre-PR-301) | 131..294 | 213 | RED |
| Fresh post-PR-301 merge | 2026-06-03 | `a1aa36c7` (post-PR-301) | 178..193 | 185 | **RED — split LOCKED** |

The CodeRabbit 150-file PR cap is canonical (`pr-guidlines.md §12`); a 185-file midpoint mandates split into two sequenced PRs with **zero touched-file overlap**.

### Per-component breakdown (post-PR-301)

| Task | Component | Files | Bucket |
|---|---|---|---|
| T7.1 | NEW factories + per-bank test runners | 27 | **7a** |
| T7.2 | MOD `src/Tests/Integration/**` reshape to `it.each(BANKS)` | 1 | **7a** |
| T7.3 | MOD `src/Tests/MockE2E/**` reshape | 0 | **7a** |
| T7.4 | MOD `src/Tests/Phases/**` reshape | 35 | **7a** |
| (infra) | NEW infra extras (`src/Tests/Helpers/`, fixtures, ESLint canary) | 35 | **7a** |
| **7a sub-total** | | **~98** | **<150 ✅** |
| T7.5 | MOD `src/Tests/Flow/**` reshape | 15 | **7b** |
| T7.6 | MOD `src/Tests/Strategy/**` reshape | 29 | **7b** |
| T7.6 | MOD per-bank `src/Tests/Banks/**` reshape | 13 | **7b** |
| T7.7 | NEW Contracts | 3 | **7b** |
| T7.8 | RES Mediator / Types / Core residue (of 197 in tree) | 15..30 | **7b** |
| T7.9 | MOD canary + ESLint rule wire-up | 3 | **7b** |
| (docs) | DOCS updates (this file + README) | 2 | **7b** |
| **7b sub-total** | | **~80..95** | **<150 ✅** |

Reference total of `*.test.ts` under `src/Tests/`: **474**. Both PRs land well under the 150 cap.

### Boundary justification

7a is the **foundation + Integration + Phases** bucket:
- T7.1 builds the factories every later commit consumes.
- T7.2–T7.3 prove the factory pattern on the easiest two clusters (Integration mostly empty already; MockE2E has zero touch needed).
- T7.4 applies it to the Phases cluster (35 files — the largest single 7a contribution but still under the cap).
- Adding the infra extras (test helpers, fixtures, new canary) here keeps all "framework code" in one PR.

7b is the **application + clean-up** bucket:
- T7.5 → T7.6 reshape the larger Flow / Strategy / Banks clusters.
- T7.7 adds the small Contracts cluster.
- T7.8 prunes the residue inside Mediator / Types / Core (only the duplicated cross-bank parts; the 167..182 genuine edge-case tests in those directories stay).
- T7.9 wires up the canary so future per-bank-only tests are blocked.

The boundary is along **commit-plan sub-clusters**, not a random file-count slice. Zero file overlap: any file touched in 7a is not touched in 7b, and vice versa.

### Sequencing

1. **7a opens first** as `refactor/phase-7-foundation-integration-phases` → CI green → CR approved → merge.
2. **7b branches off the merged 7a SHA** as `refactor/phase-7-flow-strategy-banks-residue` → its diff is purely additive over the new main.
3. Neither PR ever rebases the other's commits; the dependency is strictly forward.

---

## Cross-bank STRUCTURAL principles (the diamond)

> Tests assert **flow + contract**, not **bank**. The bank is an `it.each` input row.

| Layer | Test style | Owns | Lives in |
|---|---|---|---|
| Unit | jest, mocked deps | Edge cases (regex, parser branches, error paths) | `src/Tests/Unit/**` |
| Integration | jest + Playwright stubs | Cross-bank flow contracts via `it.each(BANKS)` | `src/Tests/Integration/**` |
| Mock-E2E | jest + recorded HTML fixtures | End-to-end flow proof per bank (cross-bank `it.each`) | `src/Tests/MockE2E/**` |
| Real-E2E (preserved as-is) | jest + live bank | Smoke (Workflow A) + per-bank cooldown (Workflow B/C) | `src/Tests/RealE2E/**` (not touched by Phase 7) |

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
  it.each(BANKS)('logs in with valid creds [%s]', async (bank) => {
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

| Bank | Suite | Why it cannot collapse into `it.each(BANKS)` |
|---|---|---|
| Hapoalim | `src/Tests/Banks/Hapoalim/WafBlock.test.ts` | WAF block detection + recovery is Hapoalim-specific (provider = Imperva). No other bank uses Imperva. |
| OneZero | `src/Tests/Banks/OneZero/OtpFlow.test.ts` | OneZero's OTP flow has unique long-term token caching (`PAYBOX_OTP_LONG_TERM`); the assertion shape doesn't apply to OTP-on-demand banks. |
| Discount | `src/Tests/Banks/Discount/AuthDiscovery.test.ts` | Discount uses a multi-step auth-discovery contract that no other bank exposes. |

These stay verbatim; only the **truly-duplicated** per-bank tests collapse.

---

## Canary list

Per the master plan and the locked canary count of **1 new in Phase 7** (the other 5 candidates I drafted in session/files/ are deferred to Phase 9):

| Canary | Target rule | Land in |
|---|---|---|
| `test-per-bank-duplication.canary.ts` | Bans `describe('Login.<bank>',` style; demands `it.each(BANKS)` | T7.9 (7b) |

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

- **Zero `src/Scrapers/**` diffs allowed in Phase 7a or 7b PRs.**
- Exception: `src/Scrapers/Pipeline/EslintCanaries/*.canary.ts` (canary files are part of the test-rule lockdown).
- Exception: `src/Tests/**` (the very files the phase is reshaping).
- If a real production bug is discovered during reshape: STOP, open a separate `fix(prod):` PR FIRST, merge, rebase the test-only branch, then resume.
- Enforcement: husky pre-commit hook blocks any matching commit on `refactor/phase-7-*`, `refactor/phase-9-*`, `chore/test-*` branches.

---

## Per-commit forecast (7a + 7b)

| Commit | Branch | Files | Cluster |
|---|---|---|---|
| **T7.0** (this doc + initial spec stubs) | 7a | 1 | docs |
| T7.1 | 7a | 27 | NEW factories + per-bank test runners (`src/Tests/Helpers/banks.ts`, `factory.ts`, runners) |
| T7.2 | 7a | 1 | MOD `src/Tests/Integration/**` (1 test reshape needed; rest already cross-bank) |
| T7.3 | 7a | 0 | MOD `src/Tests/MockE2E/**` (already cross-bank — verify only, no diff expected) |
| T7.4 | 7a | 35 | MOD `src/Tests/Phases/**` (login/dashboard/scrape phase tests → `it.each(BANKS)`) |
| (infra) | 7a | 35 | NEW `src/Tests/Helpers/`, fixtures, ESLint canary stub |
| **7a TOTAL** | | **~98** | **<150 ✅** |
| T7.5 | 7b | 15 | MOD `src/Tests/Flow/**` |
| T7.6 (Strategy) | 7b | 29 | MOD `src/Tests/Strategy/**` |
| T7.6 (per-bank) | 7b | 13 | MOD per-bank `src/Tests/Banks/**` (excluding the 3 preserved edge-case suites above) |
| T7.7 | 7b | 3 | NEW Contracts (`src/Tests/Contracts/**`) |
| T7.8 | 7b | 15..30 | RES Mediator/Types/Core residue (only duplicated cross-bank parts; edge cases stay) |
| T7.9 | 7b | 3 | MOD canary wire-up + ESLint rule registration |
| (docs) | 7b | 2 | DOCS updates (this file's 7b-relevant amendments + README "running tests" section) |
| **7b TOTAL** | | **~80..95** | **<150 ✅** |

---

## OBSERVE artifacts in session

- `session/files/probe-7-4-forecast.sh` — canonical Probe 7.4 script (re-runnable).
- `session/files/probe-7-4-post-pr-301.log` — raw output of the fresh probe against main `a1aa36c7`.
- `session/files/phase-7-observe-brief-draft.md` — earlier OBSERVE-light brief.
- `session/files/t1-inverse-husky-snippet.sh` — drop-in snippet that landed as PR #301.

## Next deliverable

T7.1 — NEW factories + per-bank test runners. Files:
- `src/Tests/Helpers/banks.ts` — exports `const BANKS = ['hapoalim', 'discount', ...]` constant + `BankId` type
- `src/Tests/Helpers/factory.ts` — `makeMockContext(bank: BankId)` factory
- `src/Tests/Helpers/runners.ts` — `runLoginFlow(ctx)`, `runDashboardFlow(ctx)`, `runScrapeFlow(ctx)` per-flow runners
- Companion `*.test.ts` for each factory/runner (Unit-level, edges-only)
- ESLint canary stub at `src/Scrapers/Pipeline/EslintCanaries/test-per-bank-duplication.canary.ts` (T7.9 wires it; T7.1 just creates the file)

The full per-assertion-ID inventory is **deferred to T7.1's pre-implementation OBSERVE step** (where it directly informs which existing tests T7.4 will reshape vs which T7.8 will prune). T7.0 ships the structural decision; T7.1 begins the application.
