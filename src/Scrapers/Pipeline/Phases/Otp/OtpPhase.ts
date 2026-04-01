/**
 * OTP phase — generic OTP detection and handling.
 * Uses mediator to detect if OTP form is present (WellKnown otpCode candidates).
 * If no OTP form detected, passes through silently (not all banks require OTP).
 *
 * pre:    detect OTP form via mediator (WellKnown otpCode field)
 * action: if OTP present, delegate to options.getOtpCode callback → fill + submit
 * post:   check errors via mediator
 *
 * NOTE: OTP input requires user interaction (SMS code).
 * The pipeline calls options.getOtpCode() which is provided by the consumer.
 * If no getOtpCode callback, OTP phase is skipped.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

/** Timeout for probing OTP form presence. */
const OTP_PROBE_TIMEOUT = 3000;

/**
 * Detect if an OTP form is present on the page.
 * Uses WellKnown otpCode candidates — if any is visible, OTP is required.
 * succeed(true) = OTP form detected. succeed(false) = no OTP (valid path).
 * @param input - Pipeline context with browser.
 * @returns Procedure with boolean detection result.
 */
async function detectOtpForm(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.mediator.has) return succeed(false);
  const mediator = input.mediator.value;
  const candidates = WK_LOGIN_FORM.mfa as unknown as readonly SelectorCandidate[];
  const result = await mediator.resolveVisible(candidates, OTP_PROBE_TIMEOUT);
  return succeed(result.found);
}

/**
 * Execute the OTP phase: detect OTP form, fill if present.
 * If no OTP form detected, passes through (not all banks require OTP).
 * @param _ctx - Pipeline context (unused, matches step signature).
 * @param input - Pipeline context.
 * @returns Updated context or pass-through.
 */
async function executeOtp(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const otpResult = await detectOtpForm(input).catch((): Procedure<boolean> => succeed(false));
  if (!isOk(otpResult) || !otpResult.value) return succeed(input);
  input.logger.debug('OTP form detected — handler not yet implemented');
  return succeed(input);
}

/** OTP phase step — generic OTP detection and handling. */
const OTP_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'otp',
  execute: executeOtp,
};

export default OTP_STEP;
export { OTP_STEP };
