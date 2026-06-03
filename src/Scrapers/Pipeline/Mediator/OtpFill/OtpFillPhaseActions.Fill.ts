/**
 * OTP-FILL ACTION — call retriever → fill code → click submit.
 * Includes the OTP timeout watchdog so user-supplied retrievers can
 * race against the configured `otpTimeoutMs` budget.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IActionContext,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { readDiagString, readDiagTarget } from '../Otp/OtpShared.js';
import { createPromise } from '../Timing/TimingActions.js';
import {
  DEFAULT_OTP_TIMEOUT_MS,
  OTP_PHASE_SETTLE_TIMEOUT_MS,
  OTP_RETRIEVER_SETTLE_MS,
} from '../Timing/TimingConfig.js';

/** Sentinel for timeout — distinguishes from empty string code. */
const OTP_TIMED_OUT = '__OTP_TIMEOUT__';

/**
 * False-returning catch handler — silences expected Playwright rejects.
 * @returns Always false.
 */
const CATCH_FALSE = (): false => false;

/**
 * Create a promise that resolves to the timeout sentinel after ms.
 * @param ms - Timeout duration.
 * @returns Promise that resolves to OTP_TIMED_OUT.
 */
function createTimeoutPromise(ms: number): Promise<string> {
  return createPromise<string>((resolve): true => {
    globalThis.setTimeout((): true => {
      resolve(OTP_TIMED_OUT);
      return true;
    }, ms);
    return true;
  });
}

/** Retriever callback type — accepts a hint, returns a code promise. */
type OtpRetriever = (hint: string) => Promise<string>;

/** Promise alias for retriever-race result. */
type RaceResult = Promise<string | false>;

/** Bundled args for {@link raceRetrieverWithTimeout}. */
interface IRaceArgs {
  readonly retriever: OtpRetriever;
  readonly hint: string;
  readonly timeoutMs: number;
}

/**
 * Race the OTP retriever against a timeout.
 * @param args - Bundled retriever + hint + timeoutMs.
 * @returns The OTP code, or false if timed out.
 */
async function raceRetrieverWithTimeout(args: IRaceArgs): RaceResult {
  const timer = createTimeoutPromise(args.timeoutMs);
  const result = await Promise.race([args.retriever(args.hint), timer]);
  if (result === OTP_TIMED_OUT) return false;
  return result;
}

/**
 * Predicate for the optional-skip diagnostic stamp written by PRE.
 * @param input - Sealed action context (carries the PRE diagnostics).
 * @returns True iff PRE marked OTP-FILL as optionally skipped.
 */
function isOtpFillOptionalSkipped(input: IActionContext): boolean {
  return input.diagnostics.lastAction.includes('optional-skip');
}

/**
 * Log the optional-skip honour and pass through unchanged.
 * @param input - Sealed action context.
 * @returns Original context untouched.
 */
function honorFillOptionalSkip(input: IActionContext): Procedure<IActionContext> {
  input.logger.debug({ message: 'OTP_FILL.ACTION skipped — optional-skip honored from PRE' });
  return succeed(input);
}

/**
 * Fail-construction helper for the missing-retriever guard.
 * @returns Failed procedure with TwoFactorRetrieverMissing type.
 */
function failOtpRetrieverMissing(): Procedure<IActionContext> {
  return fail(ScraperErrorTypes.TwoFactorRetrieverMissing, 'OTP required but no otpCodeRetriever');
}

/** Bundled args for {@link awaitOtpFromRetriever}. */
interface IRequestCodeArgs {
  readonly retriever: OtpRetriever;
  readonly logger: IPipelineContext['logger'];
  readonly hint: string;
  readonly timeoutMs: number;
}

/**
 * Log the challenge banner then race the user-supplied retriever
 * against the OTP timeout.
 * @param args - Bundle of retriever, logger, hint, timeout-ms.
 * @returns Resolved code or `false` if the timer wins.
 */
async function awaitOtpFromRetriever(args: IRequestCodeArgs): RaceResult {
  const challenge = `>>> OTP challenge: hint=${args.hint}. Waiting ${String(args.timeoutMs)}ms...`;
  args.logger.info({ message: challenge });
  return raceRetrieverWithTimeout({
    retriever: args.retriever,
    hint: args.hint,
    timeoutMs: args.timeoutMs,
  });
}

/**
 * Compose the timeout failure with a paired log line.
 * @param logger - Pipeline logger.
 * @param timeoutMs - Configured timeout (ms) for the log line.
 * @returns Failed procedure with the timeout error type.
 */
function failOtpTimeout(
  logger: IPipelineContext['logger'],
  timeoutMs: number,
): Procedure<IActionContext> {
  const msg = `>>> OTP timeout after ${String(timeoutMs)}ms — no code received`;
  logger.info({ message: msg });
  return fail(ScraperErrorTypes.Timeout, 'OTP timeout — code not received');
}

/**
 * Settle the network before invoking the user-supplied retriever.
 * @param executor - Sealed action mediator.
 * @param logger - Pipeline logger (flushed before the wait).
 * @returns `true` once the settle wait resolves.
 */
async function settleBeforeRetriever(
  executor: IActionMediator,
  logger: IPipelineContext['logger'],
): Promise<true> {
  logger.flush();
  await executor.waitForNetworkIdle(OTP_RETRIEVER_SETTLE_MS).catch(CATCH_FALSE);
  return true;
}

/** Bundled args for {@link fetchOtpCodeOrFail}. */
interface IFetchOtpArgs {
  readonly input: IActionContext;
  readonly executor: IActionMediator;
  readonly retriever: OtpRetriever;
}

/** Promise alias keeping fetchOtpCodeOrFail sig single-line. */
type OtpCodeOrFail = Promise<string | Procedure<IActionContext>>;

/**
 * Drive the retrieve-OTP sub-flow: read hint, settle, race, return code/fail.
 * @param args - Bundled input/executor/retriever.
 * @returns Resolved code string or a fail procedure on timeout.
 */
async function fetchOtpCodeOrFail(args: IFetchOtpArgs): OtpCodeOrFail {
  const { input, executor, retriever } = args;
  const hint = readDiagString(input.diagnostics, 'otpPhoneHint');
  await settleBeforeRetriever(executor, input.logger);
  const timeoutMs = input.options.otpTimeoutMs ?? DEFAULT_OTP_TIMEOUT_MS;
  const code = await awaitOtpFromRetriever({ retriever, logger: input.logger, hint, timeoutMs });
  if (!code) return failOtpTimeout(input.logger, timeoutMs);
  input.logger.info({ message: '>>> OTP code received — proceeding to fill' });
  return code;
}

/** Bundled args for {@link clickOtpSubmitTarget}. */
interface IClickOtpSubmitArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Click the optional submit target after the fill, swallowing rejects.
 * @param args - Bundled executor + target + logger.
 * @returns `true` once the click attempt completes.
 */
async function clickOtpSubmitTarget(args: IClickOtpSubmitArgs): Promise<true> {
  const { executor, target, logger } = args;
  const selRef = { contextId: target.contextId, selector: target.selector };
  await executor.clickElement(selRef).catch(CATCH_FALSE);
  logger.debug({ message: `clicked ${target.kind}="${target.candidateValue}"` });
  return true;
}

/**
 * Wait for the post-submit settle window then log completion.
 * @param executor - Sealed action mediator.
 * @param logger - Pipeline logger.
 * @returns `true` once the settle wait resolves.
 */
async function settleAfterOtpSubmit(
  executor: IActionMediator,
  logger: IPipelineContext['logger'],
): Promise<true> {
  await executor.waitForNetworkIdle(OTP_PHASE_SETTLE_TIMEOUT_MS).catch(CATCH_FALSE);
  logger.debug({ message: 'submit complete' });
  return true;
}

/** Bundled args for {@link fillAndSubmitOtpForm}. */
interface IFillAndSubmitArgs {
  readonly input: IActionContext;
  readonly executor: IActionMediator;
  readonly code: string;
}

/**
 * Click the discovered submit target (when present) after the fill.
 * @param args - Bundled input/executor.
 * @returns `true` once the optional click + log complete.
 */
async function clickSubmitIfPresent(args: IFillAndSubmitArgs): Promise<true> {
  const { input, executor } = args;
  const target = readDiagTarget(input.diagnostics, 'otpSubmitTarget');
  if (target) await clickOtpSubmitTarget({ executor, target, logger: input.logger });
  return true;
}

/** Promise alias keeping fillAndSubmitOtpForm sig single-line. */
type FillSubmitResult = Promise<Procedure<IActionContext>>;

/**
 * Fill the OTP input then optionally click submit and settle.
 * @param args - Bundled input/executor/code.
 * @returns Updated context on success, or fail if PRE target missing.
 */
async function fillAndSubmitOtpForm(args: IFillAndSubmitArgs): FillSubmitResult {
  const { input, executor, code } = args;
  const inputTarget = readDiagTarget(input.diagnostics, 'otpInputTarget');
  if (!inputTarget) return fail(ScraperErrorTypes.Generic, 'OTP input target missing from PRE');
  await executor.fillInput(inputTarget.contextId, inputTarget.selector, code);
  input.logger.debug({ message: `filled ${inputTarget.kind}="${inputTarget.candidateValue}"` });
  await clickSubmitIfPresent(args);
  await settleAfterOtpSubmit(executor, input.logger);
  return succeed(input);
}

/** Promise alias keeping executeFillAction sig single-line. */
type FillActionResult = Promise<Procedure<IActionContext>>;

/**
 * ACTION (sealed): Call retriever → fill code → click submit.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeFillAction(input: IActionContext): FillActionResult {
  if (!input.executor.has) return succeed(input);
  if (isOtpFillOptionalSkipped(input)) return honorFillOptionalSkip(input);
  const retriever = input.options.otpCodeRetriever;
  if (!retriever) return failOtpRetrieverMissing();
  const executor = input.executor.value;
  const codeOrFail = await fetchOtpCodeOrFail({ input, executor, retriever });
  if (typeof codeOrFail !== 'string') return codeOrFail;
  return fillAndSubmitOtpForm({ input, executor, code: codeOrFail });
}

export default executeFillAction;
