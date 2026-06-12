/**
 * OTP-phase timing budgets (TRIGGER + FILL + form-probe). Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/**
 * OTP-TRIGGER prelude — DOM-ready ceiling for phone-hint scan + click.
 *
 * <p>`waitForDomReady` budget before OTP-TRIGGER.PRE scans for the phone
 * hint / send-code button and before ACTION fires the click. DOM parsing
 * is sufficient — OTP screens are typically server-rendered or already
 * hydrated by the time this phase runs.
 */
export const OTP_TRIGGER_PRELUDE_TIMEOUT_MS = 6_000;

/**
 * OTP-FILL prelude — DOM-ready ceiling for OTP input discovery.
 *
 * <p>OTP-FILL.PRE budget before scanning for the OTP code input. DOM
 * parsing is sufficient (the OTP input is typically present from the
 * moment the screen renders).
 */
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
 * OTP user entry budget — single test case may extend per options.
 * Imported via re-export from `OtpFillPhaseActions.ts` so the
 * existing `Tests/Unit/.../OtpPollerPipelineTimeoutAlignment.test.ts`
 * cross-validation continues to pass without renaming.
 */
export const DEFAULT_OTP_TIMEOUT_MS = 180_000;
