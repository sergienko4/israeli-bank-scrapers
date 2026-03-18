/**
 * OTP phase — wraps OtpHandler for OTP detection and input.
 * Stub: returns succeed(input) until Step 5.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: OTP detection, input, and verification.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeOtp(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** OTP step — detects OTP screen, fills code, submits. */
const OTP_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'otp',
  execute: executeOtp,
};

export default OTP_STEP;
export { OTP_STEP };
