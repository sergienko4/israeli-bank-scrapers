/**
 * NETWORK timing budgets. Split out of {@link "./TimingConfig.js"}
 * during Phase 12b — see file for the rollout window during which
 * the {@link "./TimingConfig.js"} barrel still re-exports these names.
 */

/**
 * Fire-and-forget POST interceptor timeout.
 *
 * <p>PR #220 cut this to 30000 ms; Phase E (PR-α') restores the
 * pre-cut 120000 ms. The interceptor watches for per-card txn
 * POSTs throughout the dashboard hydration window; cycling-card
 * banks (Amex / Isracard) issue these lazily as the user lands on
 * each card view, and on slow CI runners the issuance can drag
 * past 30 s.
 */
export const NETWORK_POST_INTERCEPT_TIMEOUT_MS = 120_000;

/** Network capture poll interval for `waitForFirstId`. */
export const NETWORK_WAIT_FIRST_ID_POLL_MS = 250;
