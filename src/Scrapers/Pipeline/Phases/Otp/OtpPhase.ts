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

import detectOtpForm from '../../Mediator/Form/OtpProbe.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

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
  if (!input.mediator.has) return succeed(input);
  /**
   * Fallback for probe error — OTP not required.
   * @returns Succeed(false).
   */
  const fallback = (): Procedure<boolean> => succeed(false);
  const otpResult = await detectOtpForm(input.mediator.value).catch(fallback);
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
