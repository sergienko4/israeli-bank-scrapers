/**
 * HOME-phase timing budgets. Split out of {@link "./TimingConfig.js"}
 * during Phase 12b — see file for the rollout window during which
 * the {@link "./TimingConfig.js"} barrel still re-exports these names.
 */

/**
 * HOME prelude — SPA-ready ceiling for HOME.PRE + HOME.ACTION.
 *
 * <p>`waitForSpaReady` budget: page must be `load`+`networkidle` before
 * the resolver scans for the login trigger and before ACTION fires the
 * click. Sized below {@link HOME_FORM_READY_TIMEOUT_MS} so the total
 * per-phase wall stays unchanged.
 *
 * <p>Bumped 10_000 → 15_000 on 2026-05-13 to close the Hapoalim CI
 * race (I-3): under throttled GitHub-runner bandwidth the bank's
 * `load` event occasionally fires after 10 s because analytics
 * scripts gate it, the non-fatal prelude returns false, then the
 * downstream resolver scans a half-hydrated DOM and reports
 * `GENERIC HOME PRE: no login nav link found`. Banks that settle
 * fast (Discount, Beinleumi, Massad, VisaCal) early-exit on the
 * underlying `Promise.all([load, networkidle])` so the bump is
 * cross-bank safe. {@link HOME_RESOLVER_ENTRY_TIMEOUT_MS} carries
 * the matching probe ceiling. Pinned by HOME-PRELUDE-BUDGET-001.
 *
 * <p>Bumped 15_000 → 25_000 on 2026-05-31 (PR #281 C10) after the
 * I-3 race resurfaced 5/5 attempts on the canonical-10 baseline
 * SHA `6c2f65be`. Local docker repro on the CI-mirror image
 * (`docker/Dockerfile.ci-mirror`, residential Israel IP) measured
 * Hapoalim HOME.PRE wall at **31_532 ms** — within the old 35 s
 * joint budget but with zero headroom. GitHub-hosted Azure runners
 * consistently report ~10-20 % higher latency than residential
 * IPs (PR #234 footnote) and the bank-side Incapsula scoring on
 * runner IPs adds further variance, so the joint budget must
 * absorb the local measurement plus 20-30 s of CI overhead.
 * 25 s prelude + 30 s probe = 55 s per attempt remains far below
 * the test-level Jest timeout (300 s for E2E Real). Pinned by
 * HOME-PRELUDE-BUDGET-001 (floor bumped to 25_000 in same commit).
 */
export const HOME_PRELUDE_TIMEOUT_MS = 25_000;

/** HOME settle ceiling after click — TIMING mission cut from 15000. */
export const HOME_SETTLE_TIMEOUT_MS = 8000;

/**
 * HOME post-click short-probe ceiling — TIMING-mission cut from
 * 15_000. Covers TWO post-navigation probes that are expected to
 * succeed near-instantly:
 * <ul>
 *   <li>HOME.ACTION: `WK_HOME.ENTRY` re-locate at click time. The
 *       PRE pass (see {@link HOME_RESOLVER_ENTRY_TIMEOUT_MS}) has
 *       already verified the trigger exists; this is a cheap
 *       re-find to obtain the click locator.</li>
 *   <li>HOME.POST: `WK_HOME.FORM_CHECK` form-gate verify after the
 *       trigger click navigated to the login page. The form is
 *       already rendered; this is a confirmation probe.</li>
 * </ul>
 *
 * <p>Distinct from {@link HOME_RESOLVER_ENTRY_TIMEOUT_MS} which
 * owns the pre-click entry-trigger DISCOVERY budget (page may
 * still be hydrating; long budget needed).
 */
export const HOME_ENTRY_TIMEOUT_MS = 5000;

/**
 * HOME-resolver visible-text probe ceiling — owned here so a future
 * TIMING cut cannot silently re-introduce the Hapoalim CI race.
 *
 * <p>Centralises the previously-orphan local literal in
 * `Mediator/Home/HomeResolver.ts`. Sized to 20 s so the joint
 * budget {@link HOME_PRELUDE_TIMEOUT_MS} + this ceiling = 35 s
 * after first byte, comfortably above the ~25-30 s wall observed
 * for Hapoalim on the slowest CI runners. Pinned by
 * HOME-PRELUDE-BUDGET-001/002 (Tests/Unit/.../TimingHomePreludeBudget).
 *
 * <p>Bumped 20_000 → 30_000 on 2026-05-31 (PR #281 C10) in lockstep
 * with {@link HOME_PRELUDE_TIMEOUT_MS}. Local docker repro of
 * Hapoalim (CI-mirror image, residential IP) measured HOME.PRE wall
 * at 31_532 ms — the previous 35 s joint budget was breached by
 * Azure runner anti-bot latency. New joint budget = 25 s prelude
 * + 30 s probe = 55 s per attempt, headroom for the documented
 * "~30 s observed on slowest CI runners" plus CI variance.
 */
export const HOME_RESOLVER_ENTRY_TIMEOUT_MS = 30_000;

/** HOME SPA URL change wait after click (Angular routing delay). */
export const HOME_SPA_NAV_TIMEOUT_MS = 10000;

/** HOME form-ready gate probe — bank-side rendering ceiling. */
export const HOME_FORM_READY_TIMEOUT_MS = 15000;

/** HOME modal-overlay settle ceiling. */
export const HOME_MODAL_SETTLE_TIMEOUT_MS = 15000;
