/**
 * OTP timing budgets. Split out of the TimingConfig barrel, which was retired
 * once every importer moved to a domain file.
 *
 * <p>Only `DEFAULT_OTP_TIMEOUT_MS` is read today, by the sms-otp pre-hook. The
 * other budgets belong to the OTP trigger and fill screens, which no longer
 * exist, and no module reads them.
 */

/** OTP-TRIGGER prelude ceiling (ms). */
export const OTP_TRIGGER_PRELUDE_TIMEOUT_MS = 6_000;

/** OTP-FILL prelude ceiling (ms). */
export const OTP_FILL_PRELUDE_TIMEOUT_MS = 6_000;

/** OTP trigger / fill post-action settle ceiling — TIMING cut from 10000. */
export const OTP_PHASE_SETTLE_TIMEOUT_MS = 5000;

/** OTP-TRIGGER POST scope-bound visibility re-probe ceiling — Mission 4. */
export const OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS = 2000;

/** OTP form-input discovery probe ceiling. */
export const OTP_FORM_PROBE_TIMEOUT_MS = 3000;

/** OTP submit-button discovery probe ceiling — TIMING cut from 15000. */
export const OTP_SUBMIT_PROBE_TIMEOUT_MS = 5000;

/** OTP error-banner probe ceiling. */
export const OTP_ERROR_PROBE_TIMEOUT_MS = 2000;

/** OTP retriever pre-prompt settle. */
export const OTP_RETRIEVER_SETTLE_MS = 500;

/**
 * OTP user entry budget (ms) the sms-otp pre-hook applies when the credentials
 * carry no `otpTimeoutMs`. The real-bank test poller (`E2eReal/OtpPoller.ts`)
 * mirrors it so it never gives up before the flow does.
 */
export const DEFAULT_OTP_TIMEOUT_MS = 180_000;
