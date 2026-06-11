/**
 * AUTH-DISCOVERY-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/**
 * AUTH-DISCOVERY dashboard reveal probe budget.
 *
 * <p>PR #220 cut this to 3000 ms in the TIMING mission, but the cut
 * left slow Azure-CI runners short of the time the bank's SPA needs
 * to commit a REVEAL anchor in DOM. Phase E (PR-α') restores the
 * pre-cut budget of 8000 ms; combined with the catalog-driven
 * iteration in `MatrixLoopStrategy`, this eliminates the silent
 * Isracard `AUTH_DISCOVERY_DASHBOARD_NOT_READY` family of failures
 * the CI mask had been hiding.
 */
export const AUTH_DISCOVERY_DASHBOARD_WAIT_MS = 8000;

/** AUTH-DISCOVERY auth-module sessionStorage poll ceiling — TIMING cut from 10000. */
export const AUTH_POLL_TIMEOUT_MS = 3_000;

/**
 * AUTH-DISCOVERY.PRE settle ceiling — gives the SPA time to flush
 * post-login redirect chatter (auth-token endpoints, header-bearer
 * fetches, redirect navigation) before AUTH-DISCOVERY.PRE inventories
 * the capture pool. Event-driven via `mediator.waitForNetworkIdle`
 * (early-exits the moment the network goes idle), so fast banks pay
 * 0 ms while slow-redirect banks pay up to this ceiling. Starts at
 * 3 s per architectural review — increase only if a slow-redirect
 * bank empirically requires it.
 */
export const AUTH_DISCOVERY_PRE_SETTLE_MS = 3_000;

/**
 * AUTH-DISCOVERY.FINAL settle ceiling — Mission M4.F1. Before FINAL
 * reads `mediator.getCurrentUrl()` to compare against the URL
 * LOGIN.PRE emitted, give the page one more event-driven idle wait
 * (1 s ceiling) so the URL we compare against is the FINAL post-auth
 * URL, not a transient redirect intermediate. Fast banks pay 0 ms;
 * banks with a slow last redirect pay up to the ceiling.
 */
export const AUTH_DISCOVERY_FINAL_SETTLE_MS = 1_000;
