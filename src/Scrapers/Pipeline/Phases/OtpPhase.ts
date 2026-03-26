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

import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { WK } from '../Registry/PipelineWellKnown.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Raw text value from a selector candidate. */
type CandidateText = string;
/** Whether an OTP form field became visible within the probe timeout. */
type OtpDetected = boolean;

/** Timeout for probing OTP form presence. */
const OTP_PROBE_TIMEOUT = 3000;

/**
 * Detect if an OTP form is present on the page.
 * Uses WellKnown otpCode candidates — if any is visible, OTP is required.
 * @param input - Pipeline context with browser.
 * @returns True if OTP form is detected.
 */
async function detectOtpForm(input: IPipelineContext): Promise<boolean> {
  if (!input.browser.has) return false;
  const page = input.browser.value.page;
  const candidates = WK.LOGIN.ACTION.FORM.mfa;
  /**
   * Build a text locator for a candidate's visible text value.
   * @param c - Selector candidate with text value.
   * @returns Playwright locator for the candidate text.
   */
  const toLocator = (c: SelectorCandidate): ReturnType<typeof page.locator> => {
    const text: CandidateText = c.value;
    return page.locator(`text=${text}`).first();
  };
  const locators = candidates.map(toLocator);
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: OTP_PROBE_TIMEOUT });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): OtpDetected => r.status === 'fulfilled');
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
  const hasOtp = await detectOtpForm(input).catch((): OtpDetected => false);
  if (!hasOtp) return succeed(input);
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
