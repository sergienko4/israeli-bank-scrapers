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
import {
  SCOPE_INTACT_POLL_INTERVAL_MS,
  SCOPE_INTACT_SETTLE_BUDGET_DEFAULT_MS,
} from '../../Timing/TimingConfig.js';
import { hasStayedOnLoginUrl } from '../LoginUrlHelpers.js';
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
 * Read the scope-intact poll budget from the bank config.
 *
 * <p>Banks with slow AngularJS auth (Amex, Isracard `personalarea`) opt in via
 * {@link IPipelineBankConfig.scopeIntactSettleBudgetMs}. Non-opted banks get the
 * default ≈ 4 s (≤2 probes — unchanged behavior).
 * @param scopeArgs - Scope-intact bundle containing the pipeline context.
 * @returns Configured budget ms, or the default for non-opted banks.
 */
function readSettleBudget(scopeArgs: IScopeIntactArgs): number {
  return scopeArgs.input.config.scopeIntactSettleBudgetMs ?? SCOPE_INTACT_SETTLE_BUDGET_DEFAULT_MS;
}

/**
 * Check whether any login-progression signal has fired.
 *
 * <p>Signals: OTP screen painted (tri-state), password selector gone, or URL
 * navigated away. Any one firing means the in-flight auth succeeded — the
 * InvalidPassword verdict MUST NOT be emitted (PR #282 anti-masking contract).
 * @param mediator - Element mediator (current URL + element counts).
 * @param scopeArgs - Scope-intact bundle (selector + pipeline context).
 * @returns True when any transition signal has fired.
 */
async function hasProgressed(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<boolean> {
  const otp = await otpScreenVisible(mediator);
  if (pickOtpFallthroughLog(otp) !== false) return true;
  if (!hasStayedOnLoginUrl(mediator, scopeArgs.input)) return true;
  return (await mediator.countBySelector(scopeArgs.selector)) === 0;
}

/**
 * Wait one poll interval then re-probe for login progression.
 *
 * <p>On Amex / Isracard, {@link IElementMediator.waitForNetworkIdle} always
 * times out (constant Google-Ads / pagead beacons), degrading to a bounded
 * sleep. In tests the stub no-ops so iterations stay instant.
 * @param mediator - Element mediator.
 * @param scopeArgs - Scope-intact bundle.
 * @param interval - Wait duration in milliseconds.
 * @returns True when a transition signal fires after the wait.
 */
async function doOnePollIteration(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
  interval: number,
): Promise<boolean> {
  await mediator.waitForNetworkIdle(interval).catch((): false => false);
  return hasProgressed(mediator, scopeArgs);
}

/**
 * Tail-recursive poll step for {@link pollUntilTransition}.
 * @param mediator - Element mediator.
 * @param scopeArgs - Scope-intact bundle.
 * @param remainingIters - Iterations remaining before the budget elapses.
 * @returns Fall-through `false` if a transition fires, else InvalidPassword.
 */
async function runPollIter(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
  remainingIters: number,
): Promise<Procedure<IPipelineContext> | false> {
  if (remainingIters <= 0) return emitScopeIntactFailure(scopeArgs);
  if (await doOnePollIteration(mediator, scopeArgs, SCOPE_INTACT_POLL_INTERVAL_MS)) return false;
  return runPollIter(mediator, scopeArgs, remainingIters - 1);
}

/**
 * Bounded poll on real login-progression signals.
 *
 * <p>Replaces the single settle + single reprobe. Budget is per-bank (OCP via config):
 * Amex and Isracard opt in to 45 s to survive the ~40 s AngularJS auth
 * retry cycle (PR #385). Non-opted banks use ≈ 4 s (≤2 probes).
 * Genuinely-invalid logins never transition, so budget elapse still
 * emits InvalidPassword — PR #282 anti-masking contract preserved.
 * @param mediator - Element mediator.
 * @param scopeArgs - Scope-intact bundle (includes bank config for budget).
 * @returns Fall-through `false` if a transition fires, else InvalidPassword.
 */
async function pollUntilTransition(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const iters = Math.ceil(readSettleBudget(scopeArgs) / SCOPE_INTACT_POLL_INTERVAL_MS);
  return runPollIter(mediator, scopeArgs, iters);
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
  return pollUntilTransition(mediator, scopeArgs);
}
