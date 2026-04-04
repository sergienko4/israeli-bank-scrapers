/**
 * OTP phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    detect OTP form via mediator (WellKnown mfa field)
 * ACTION: if OTP detected, delegate to handler (stub — not yet implemented)
 * POST:   validate OTP result (no-op for now)
 * FINAL:  signal readiness to DASHBOARD
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import detectOtpForm from '../Form/OtpProbe.js';

/** Whether an OTP form was detected. */
type OtpDetected = boolean;

/**
 * PRE: Detect OTP form via mediator probe.
 * @param input - Pipeline context with mediator.
 * @returns Updated context with otpDetected in diagnostics.
 */
async function executeDetectOtp(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  /**
   * Fallback for probe error — OTP not required.
   * @returns Succeed(false).
   */
  const fallback = (): Procedure<boolean> => succeed(false);
  const probeResult = await detectOtpForm(input.mediator.value).catch(fallback);
  const isDetected: OtpDetected = isOk(probeResult) && probeResult.value;
  const diag = { ...input.diagnostics, lastAction: `otp-pre (detected=${String(isDetected)})` };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * ACTION: Handle OTP if detected — stub, not yet implemented.
 * @param input - Pipeline context.
 * @returns Pass-through (always succeed).
 */
async function executeHandleOtp(
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

/**
 * POST: Validate OTP result — no-op passthrough (future implementation).
 * @param input - Pipeline context.
 * @returns Pass-through.
 */
function executeValidateOtp(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/**
 * FINAL: Signal readiness to DASHBOARD.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics stamp.
 */
function executeSignalToDashboard(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const diag = { ...input.diagnostics, lastAction: 'otp-final' };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

export { executeDetectOtp, executeHandleOtp, executeSignalToDashboard, executeValidateOtp };
