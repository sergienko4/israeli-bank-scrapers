/**
 * LOGIN-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/** LOGIN form-frame scan budget per frame. */
export const LOGIN_PER_FRAME_SCAN_TIMEOUT_MS = 3000;

/** LOGIN post-submit settle ceiling. */
export const LOGIN_POST_SUBMIT_SETTLE_TIMEOUT_MS = 15000;

/**
 * LOGIN.POST prelude — SPA-ready ceiling for the post-submit redirect.
 *
 * <p>After form submission, banks redirect / mutate to OTP screen or
 * dashboard. The prelude waits for `load`+`networkidle` so the POST
 * validator reads a stable URL + DOM, not a transient intermediate.
 */
export const LOGIN_PRELUDE_POST_TIMEOUT_MS = 8_000;

/** LOGIN traffic-wait ceiling for organic SPA traffic — TIMING cut from 30000. */
export const LOGIN_TRAFFIC_WAIT_TIMEOUT_MS = 10000;

/** LOGIN cookie-audit network-idle wait. */
export const LOGIN_COOKIE_AUDIT_NETWORK_IDLE_MS = 10000;

/**
 * LOGIN.POST scope-intact in-flight settle budget.
 *
 * <p>Bounds the single network settle the scope-intact disambiguator
 * awaits before re-probing for the OTP screen. Sized for an AngularJS
 * login-iframe auth round-trip (Amex/Isracard `personalarea`), matching
 * the shared `PHASE_SETTLE_MS` reference (4000ms): long enough for an
 * in-flight auth XHR to paint OTP / navigate, short enough not to stall a
 * genuinely-invalid login (which never transitions).
 */
export const SCOPE_INTACT_SETTLE_MS = 4000;

/**
 * Default scope-intact poll budget for banks without a per-bank override.
 *
 * <p>≈ current single-settle so non-opted banks behave essentially as today
 * (≤2 probes over the same time window). Banks with slow AngularJS auth
 * (Amex, Isracard) override this via `IPipelineBankConfig.scopeIntactSettleBudgetMs`.
 */
export const SCOPE_INTACT_SETTLE_BUDGET_DEFAULT_MS = SCOPE_INTACT_SETTLE_MS;

/**
 * Per-iteration poll wait between transition re-probes.
 *
 * <p>On Amex / Isracard, `waitForNetworkIdle(SCOPE_INTACT_POLL_INTERVAL_MS)` always
 * times out (constant Google-Ads / pagead / doubleclick beacons), degrading to
 * a bounded sleep. In tests the stub no-ops so iterations stay instant.
 */
export const SCOPE_INTACT_POLL_INTERVAL_MS = 2500;
