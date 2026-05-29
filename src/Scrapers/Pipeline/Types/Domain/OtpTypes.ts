/**
 * OTP-related domain types — split out of PipelineContext.ts
 * for Phase 1 god-file decoupling.
 *
 * Public surface (re-exported via PipelineContext.ts barrel):
 *  - IOtpTrigger, IOtpFill           (slim emit shapes per Mission M4.F1)
 *  - EMPTY_OTP_TRIGGER, EMPTY_OTP_FILL (test-path defaults)
 */

/**
 * OTP-TRIGGER snapshot committed by OTP-TRIGGER.FINAL — Mission 4 of
 * the CI quality hardening plan. Carries the masked phone hint, the
 * boolean signal that the trigger click landed, and the scope-bound
 * validation outcome (target gone OR auth-domain HTTP 2xx since the
 * click). Mirrors the slim value-type shape used by
 * {@link IAccountDiscovery} and {@link IAuthDiscovery}: only fields
 * downstream consumers need; phase-internal artefacts emit via
 * telemetry events but do NOT travel on `ctx`.
 */
interface IOtpTrigger {
  /** Last 1-4 digits surfaced by PRE's phone-hint extractor. */
  readonly phoneHint: string;
  /** True when ACTION's clickElement resolved without throwing. */
  readonly triggered: boolean;
  /**
   * True when POST verified the trigger's scope-bound effect: the
   * trigger target either disappeared after the click OR a 2xx HTTP
   * response from the bank's auth domain landed since
   * `triggerClickedAt`.
   */
  readonly scopeValidated: boolean;
  /**
   * URL baton (Mission M4.F1) — copied forward from
   * `ctx.login.value.urlBeforeSubmit` so AUTH-DISCOVERY.FINAL reads
   * one consistent contract regardless of which auth phase ran last.
   * OTP-TRIGGER does not re-capture the URL; it preserves the value
   * the previous phase emitted.
   */
  readonly urlBeforeSubmit: string;
}

/**
 * Empty default for test paths. Mirrors EMPTY_AUTH_DISCOVERY's role
 * in the ACCOUNT-RESOLVE / TXN-endpoint patterns.
 */
const EMPTY_OTP_TRIGGER: IOtpTrigger = {
  phoneHint: '',
  triggered: false,
  scopeValidated: false,
  urlBeforeSubmit: '',
};

/**
 * OTP-FILL slim emit — Mission M4.F1. Always populated when OTP-FILL
 * ran (whether it actually filled an OTP, soft-skipped because
 * `required=false`, or bypassed under MOCK_MODE). Carries
 * {@link urlBeforeSubmit} as a baton so AUTH-DISCOVERY.FINAL reads
 * the same field regardless of which auth-ladder shape the bank
 * needed (5 supported flows: LOGIN-only, +OTP-TRIGGER,
 * +OTP-TRIGGER+OTP-FILL, +OTP-FILL, +optional-OTP-FILL).
 */
interface IOtpFill {
  /**
   * URL baton — captured at OTP-FILL.PRE entry when the OTP form
   * was found, OR copied forward from
   * {@link IOtpTrigger.urlBeforeSubmit} / {@link ILoginState.urlBeforeSubmit}
   * when OTP-FILL soft-skipped.
   */
  readonly urlBeforeSubmit: string;
}

/** Empty default for test paths. */
const EMPTY_OTP_FILL: IOtpFill = { urlBeforeSubmit: '' };

export type { IOtpFill, IOtpTrigger };
export { EMPTY_OTP_FILL, EMPTY_OTP_TRIGGER };
