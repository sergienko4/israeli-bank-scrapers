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

/**
 * Body-read settle ceiling for the traffic-wait success path.
 *
 * <p>`page.waitForResponse` resolves on response HEADERS, but the
 * capture listener only appends a body-bearing endpoint after
 * `response.text()` resolves (~2-3 ms later). Once the URL has
 * matched, `awaitTraffic` re-polls the live capture pool for up
 * to this budget so the just-arrived body is observed instead of a
 * 2-3 ms-early miss. One `NETWORK_WAIT_FIRST_ID_POLL_MS` tick is
 * the typical cost; this ceiling only bounds a pathological slow body
 * read and is never consumed on a healthy response.
 */
export const NETWORK_BODY_SETTLE_MS = 1_000;
