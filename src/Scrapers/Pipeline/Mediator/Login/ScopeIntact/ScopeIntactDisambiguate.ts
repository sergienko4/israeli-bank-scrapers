/**
 * Scope-intact failure disambiguation (OTP fall-through vs invalid creds).
 *
 * <p>Phase 12d split: extracted from {@link ../LoginScopeIntact.ts}.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import { fail, type IProcedureFailure, type Procedure } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { otpScreenVisible, pickOtpFallthroughLog } from './ScopeIntactOtp.js';
import { type IScopeIntactArgs, SCOPE_INTACT_FAIL_MSG } from './ScopeIntactTypes.js';

/**
 * Emit the structured "scope intact + URL unchanged" failure.
 * @param args - Bundled scope state.
 * @returns Failure procedure tagged `InvalidPassword`.
 */
export function emitScopeIntactFailure(args: IScopeIntactArgs): IProcedureFailure {
  const masked = maskVisibleText(args.selector);
  const countStr = String(args.count);
  args.input.logger.debug({
    message: `POST: scope intact + URL unchanged — selector ${masked} count=${countStr}`,
  });
  return fail(ScraperErrorTypes.InvalidPassword, SCOPE_INTACT_FAIL_MSG);
}

/**
 * Log fall-through and return `false` so the caller can compose in one line.
 * @param scopeArgs - Scope-intact bundle (for the logger).
 * @param message - Pre-built fall-through trace log.
 * @returns Always `false`.
 */
export function emitFallthroughLog(scopeArgs: IScopeIntactArgs, message: string): false {
  scopeArgs.input.logger.debug({ message });
  return false;
}

/**
 * Disambiguate "ambiguous scope intact" via the OTP-screen probe.
 * @param mediator - Element mediator (for the OTP probe).
 * @param scopeArgs - Bundled scope state.
 * @returns Failure procedure on confirmed scope-intact failure, else `false`.
 */
export async function disambiguateScopeIntact(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const otpVisibility = await otpScreenVisible(mediator);
  const fallthrough = pickOtpFallthroughLog(otpVisibility);
  if (fallthrough !== false) return emitFallthroughLog(scopeArgs, fallthrough);
  return emitScopeIntactFailure(scopeArgs);
}
