/**
 * PRE-LOGIN-phase timing budgets.
 *
 * <p>Every value here is a ceiling, not a target: the PRE-LOGIN stage
 * races a reveal control and a credential form that different banks
 * render at very different speeds, so each probe gets its own budget
 * rather than one shared timeout.
 */

/** PRE-LOGIN reveal-button discovery probe ceiling. */
export const PRELOGIN_DISCOVER_TIMEOUT_MS = 15000;

/** PRE-LOGIN private-customers nav ceiling. */
export const PRELOGIN_REVEAL_NAV_TIMEOUT_MS = 15000;

/** PRE-LOGIN target-resolve ceiling. */
export const PRELOGIN_RESOLVE_TARGET_TIMEOUT_MS = 5000;

/** PRE-LOGIN credential-area click ceiling. */
export const PRELOGIN_CRED_AREA_TIMEOUT_MS = 10000;

/** PRE-LOGIN form-gate validation probe ceiling. */
export const PRELOGIN_FORM_GATE_TIMEOUT_MS = 5000;

/** PRE-LOGIN OTP/password field probe ceiling. */
export const PRELOGIN_FORM_PROBE_TIMEOUT_MS = 3000;

/** PRE-LOGIN POST settle before login gate. */
export const PRELOGIN_FORM_POST_TIMEOUT_MS = 15000;
