/**
 * INIT-phase timing budgets. Split out of {@link "./TimingConfig.js"}
 * during Phase 12b — see file for the rollout window during which
 * the {@link "./TimingConfig.js"} barrel still re-exports these names.
 */

/**
 * INIT.ACTION navigation commit ceiling — Mission M4.F1 follow-up.
 * Replaces Playwright's 30 s default with a 30 s commit-only wait.
 * `page.goto(url, { waitUntil: 'commit' })` returns as soon as the
 * server responds with the first byte (TLS done + HTTP headers
 * received). Camoufox-isolated probe (2026-05-10) measured every
 * browser-flow bank below 1 s for `commit`; local docker probe on
 * residential IP reproduces sub-second commits on Beinleumi
 * (`fibi.co.il`). The ceiling was 15 s — bumped to 30 s on
 * 2026-06-01 as a defensive measure for CI runner pools where the
 * bank's first TCP/TLS byte occasionally exceeds the old budget.
 * Happy-path is unaffected (commit lands well before 15 s); the
 * extra 15 s headroom only matters when the runner-side network
 * is slow to establish the bank's TLS session.
 */
export const INIT_NAV_COMMIT_TIMEOUT_MS = 30_000;

/**
 * INIT.FINAL `domcontentloaded` ceiling — Mission M4.F1 follow-up.
 *
 * @deprecated Mission M4.F2.0: use {@link "./ElementsTimingConfig.js".ELEMENTS_DOM_READY_TIMEOUT_MS}.
 *   The wait pattern is shared by INIT.FINAL and LOGIN.PRE (both use
 *   {@link "../Elements/PageReadiness.js"} `waitForDomReady`) so the
 *   constant moved to the cross-phase ELEMENTS namespace. Re-exported
 *   here only so external callers do not break in a single commit.
 */
export const INIT_DOM_READY_TIMEOUT_MS = 10_000;
