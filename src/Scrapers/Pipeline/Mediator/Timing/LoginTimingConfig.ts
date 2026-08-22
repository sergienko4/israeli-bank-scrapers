/**
 * LOGIN-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/** LOGIN form-frame scan budget per frame. */
export const LOGIN_PER_FRAME_SCAN_TIMEOUT_MS = 3000;

/**
 * Poll window for re-probing a login field before it degrades to the
 * positional heuristic. Some banks reveal their second credential input
 * only after the first renders, so a single miss must not be treated as
 * absence. Polling returns as soon as the anchor appears, so the timeout
 * is only paid when the field genuinely is not there.
 */
export const LOGIN_FIELD_RERESOLVE_WAIT = { timeout: 1500, interval: 250 } as const;

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

/** LOGIN completion-poll interval between settle re-checks. */
export const LOGIN_COMPLETION_POLL_INTERVAL_MS = 5000;

/** LOGIN completion-poll maximum attempts (≈70s ceiling: 14 waits × 5s interval). */
export const LOGIN_COMPLETION_POLL_MAX_ATTEMPTS = 15;

/** Slow-AngularJS login completion-poll budget (Isracard, Amex). */
export const ANGULAR_LOGIN_POLL = {
  intervalMs: LOGIN_COMPLETION_POLL_INTERVAL_MS,
  maxAttempts: LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
} as const;
