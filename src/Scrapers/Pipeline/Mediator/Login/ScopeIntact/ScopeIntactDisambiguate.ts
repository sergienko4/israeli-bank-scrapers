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
import { hasStayedOnLoginUrl } from '../LoginUrlHelpers.js';
import { otpScreenVisible, pickOtpFallthroughLog } from './ScopeIntactOtp.js';
import {
  type IScopeIntactArgs,
  SCOPE_INTACT_FAIL_MSG,
  SCOPE_LEFT_LOGIN_URL_LOG,
  SCOPE_TORN_DOWN_FALLTHROUGH_LOG,
} from './ScopeIntactTypes.js';

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
 * Re-read the page, then fail only if the login scope is still there.
 *
 * <p>The URL and presence samples behind {@link IScopeIntactArgs} are taken
 * ~200ms after submit, but this verdict is reached only once the OTP probe
 * has run for up to 3s. Discount answers a *successful* submit with a 301 to
 * its authenticated app ~370ms after submit — later than the sample, so the
 * sample records "still on the login page" and, three seconds later, that
 * stale reading condemns a session that had in fact authenticated. Re-reading
 * here keys the verdict to where the browser is when the verdict is made.
 * A moved URL is positive evidence of navigation; a form that can no longer
 * be observed is weaker, so it is only ever read as unknown, never as proof.
 * @param mediator - Element mediator (URL + visibility probes).
 * @param scopeArgs - Bundled scope state.
 * @returns Failure procedure while the login scope holds, otherwise `false`.
 */
async function failWhileScopeHolds(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<IProcedureFailure | false> {
  const isOnLoginUrl = hasStayedOnLoginUrl(mediator, scopeArgs.input);
  if (!isOnLoginUrl) return emitFallthroughLog(scopeArgs, SCOPE_LEFT_LOGIN_URL_LOG);
  const isOnScreen = await mediator.isVisibleBySelector(scopeArgs.selector);
  if (!isOnScreen) return emitFallthroughLog(scopeArgs, SCOPE_TORN_DOWN_FALLTHROUGH_LOG);
  return emitScopeIntactFailure(scopeArgs);
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
  return failWhileScopeHolds(mediator, scopeArgs);
}
