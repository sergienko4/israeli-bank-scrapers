/**
 * OTP-FILL POST + FINAL.
 * POST: validate the OTP submission — banner error + re-probe.
 * FINAL: dashboard reveal — cookie audit + diagnostic stamp.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpError, detectOtpForm } from '../Form/OtpProbe.js';
import { OTP_FALLBACK, unwrapProbe } from '../Otp/OtpShared.js';

/** Procedure alias keeping single-line signatures. */
type PostProc = Procedure<IPipelineContext>;

/**
 * Fail the POST stage with a masked error banner message.
 * @param logger - Pipeline logger.
 * @param errorResult - Resolution result from {@link detectOtpError}.
 * @returns Failed procedure with `InvalidOtp` type.
 */
function failOnOtpErrorBanner(
  logger: IPipelineContext['logger'],
  errorResult: Awaited<ReturnType<typeof detectOtpError>>,
): PostProc {
  traceResolution(logger, 'OTP_FILL.POST error', errorResult);
  const msg = maskVisibleText(errorResult.value);
  return fail(ScraperErrorTypes.InvalidOtp, `OTP rejected — ${msg}`);
}

/**
 * Re-probe the OTP form after submit; still-visible means silent reject.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True iff the OTP form is still present.
 */
async function isOtpFormStillPresent(
  mediator: IElementMediator,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  const mfaResult = unwrapProbe(await detectOtpForm(mediator).catch(OTP_FALLBACK));
  traceResolution(logger, 'OTP_FILL.POST re-probe', mfaResult);
  return mfaResult.found;
}

/**
 * POST: Validate OTP — banner detect + form re-probe.
 * @param input - Pipeline context.
 * @returns Succeed if accepted, fail if rejected.
 */
async function executeFillPost(input: IPipelineContext): Promise<PostProc> {
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  const errorResult = await detectOtpError(mediator);
  if (errorResult.found) return failOnOtpErrorBanner(input.logger, errorResult);
  const isFormStillVisible = await isOtpFormStillPresent(mediator, input.logger);
  if (isFormStillVisible) return fail(ScraperErrorTypes.InvalidOtp, 'OTP form still visible');
  input.logger.debug({ message: 'otp accepted' });
  return succeed(input);
}

/**
 * Log the post-final cookie + URL snapshot.
 * @param logger - Pipeline logger.
 * @param cookieCount - Cookie jar size after the OTP-FILL settle.
 * @param currentUrl - Final URL captured at FINAL entry.
 * @returns Sentinel `true`.
 */
function logFillFinalState(
  logger: IPipelineContext['logger'],
  cookieCount: number,
  currentUrl: string,
): true {
  const msg = `cookies=${String(cookieCount)} url=${maskVisibleText(currentUrl)}`;
  logger.debug({ message: msg });
  return true;
}

/**
 * Commit the FINAL diagnostics with `lastAction` stamped.
 * @param input - Pipeline context.
 * @param cookieCount - Cookies observed after OTP-FILL settle.
 * @returns Succeed with stamped diagnostics.
 */
function commitFillFinalDiag(input: IPipelineContext, cookieCount: number): PostProc {
  const label = `otp-fill-final (cookies=${String(cookieCount)})`;
  const diag = { ...input.diagnostics, lastAction: label };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Count session cookies.
 * @param mediator - Element mediator.
 * @returns Cookie count.
 */
async function countCookies(mediator: IElementMediator): Promise<number> {
  const cookies = await mediator.getCookies();
  return cookies.length;
}

/**
 * Succeed with diagnostics stamp.
 * @param input - Pipeline context.
 * @param action - Diagnostic label.
 * @returns Updated context.
 */
function succeedWithDiag(input: IPipelineContext, action: string): PostProc {
  const diag = { ...input.diagnostics, lastAction: action };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * FINAL: Prove dashboard loaded — cookie audit + log snapshot.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
async function executeFillFinal(input: IPipelineContext): Promise<PostProc> {
  if (!input.mediator.has) return succeedWithDiag(input, 'otp-fill-final (no mediator)');
  const mediator = input.mediator.value;
  const cookieCount = await countCookies(mediator);
  const currentUrl = mediator.getCurrentUrl();
  logFillFinalState(input.logger, cookieCount, currentUrl);
  return commitFillFinalDiag(input, cookieCount);
}

export { executeFillFinal, executeFillPost };
