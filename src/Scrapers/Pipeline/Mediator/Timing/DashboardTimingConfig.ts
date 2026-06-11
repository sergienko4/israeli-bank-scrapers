/**
 * DASHBOARD-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/**
 * DASHBOARD prelude — SPA-ready ceiling for PRE + ACTION.
 *
 * <p>`waitForSpaReady` budget before DASHBOARD.PRE resolves account /
 * navigation targets and before ACTION fires the click. Dashboard pages
 * are SPA-heavy (Backbase modules on Amex / Isracard); the click must
 * land after JS hydration so the bank's SPA router responds.
 */
export const DASHBOARD_PRELUDE_TIMEOUT_MS = 10_000;

/** DASHBOARD SPA transaction-link probe ceiling. */
export const DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS = 15000;

/** DASHBOARD menu settle after toggle click. */
export const DASHBOARD_MENU_SETTLE_MS = 5000;

/** DASHBOARD post-login redirect settle — TIMING cut from 15000. */
export const DASHBOARD_SETTLE_MS = 5000;

/**
 * DASHBOARD success-probe resolveVisible ceiling.
 *
 * <p>PR #220 cut this to 8000 ms; Phase E (PR-α') restores the
 * pre-cut 30000 ms so slow Azure-CI runners have the same envelope
 * as the host runs. SPA-bound success-probes that race a 8 s
 * window legitimately need this budget when the bank's hydration
 * window is long (Backbase modules on Amex / Isracard).
 */
export const DASHBOARD_SUCCESS_TIMEOUT_MS = 30000;

/**
 * DASHBOARD reveal-string resolveVisible ceiling.
 *
 * <p>PR #220 cut this to 3000 ms; Phase E (PR-α') restores the
 * pre-cut 15000 ms to give the reveal probe the same envelope as
 * the original design. Combined with the longer
 * {@link "./AuthDiscoveryTimingConfig.js".AUTH_DISCOVERY_DASHBOARD_WAIT_MS}
 * this closes the CI race window the Isracard mask had been hiding.
 */
export const DASHBOARD_REVEAL_TIMEOUT_MS = 15000;

/** DASHBOARD SPA-render timeout for href-extraction probe. */
export const DASHBOARD_TRIGGER_RENDER_TIMEOUT_MS = 10000;

/** DASHBOARD date-filter element-visible ceiling. */
export const DASHBOARD_DATE_FILTER_TIMEOUT_MS = 5000;

/** DASHBOARD organic nav + filter settle — TIMING cut from 15000. */
export const DASHBOARD_ORGANIC_IDLE_MS = 3000;

/** DASHBOARD wait after txn-endpoint match before SCRAPE handoff. */
export const DASHBOARD_POST_MATCH_TXN_WAIT_MS = 4000;

/** DASHBOARD final TXN URL capture wait. */
export const DASHBOARD_FINAL_TXN_WAIT_MS = 8000;

/** DASHBOARD change-password probe timeout. */
export const DASHBOARD_CHANGE_PWD_TIMEOUT_MS = 3000;
