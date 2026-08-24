/**
 * ACCOUNT-RESOLVE-phase timing budgets. Split out of the TimingConfig barrel during
 * Phase 12b. The barrel was retired once every importer moved to a
 * domain file.
 */

/**
 * ACCOUNT-RESOLVE first-id-bearing-capture wait budget. Bumped from
 * 10s to 20s after live Discount run 10-05-2026_02325569 timed out
 * with `pool=1` while the previous run had `pool=72`. Serves as a
 * cumulative-cut absorber: TIMING reductions to upstream phases
 * shift this phase earlier in absolute time, so a longer ceiling
 * keeps slow-bank runs reliable.
 */
export const ACCOUNT_RESOLVE_BUDGET_MS = 20_000;

/** ACCOUNT-RESOLVE poll interval driving the recursive wait-loop. */
export const ACCOUNT_RESOLVE_POLL_MS = 250;
