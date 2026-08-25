/**
 * INIT-phase timing budgets. Split out of the TimingConfig barrel during
 * Phase 12b. The barrel was retired once every importer moved to a
 * domain file.
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
