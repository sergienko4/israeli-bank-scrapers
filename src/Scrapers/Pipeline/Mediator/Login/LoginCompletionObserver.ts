/**
 * LOGIN-completion ENFORCER — composes the four LOGIN-LOCAL completion
 * signals (spinner-gone / error-absent / advanced-past-login / form-gone)
 * through a CONFIG-DRIVEN settle poll, PII-safe-logs the snapshot, and
 * returns a Procedure verdict for LOGIN.final.
 *
 * <p>NEUTRAL BY DEFAULT: enforcement is gated on the bank opting into a
 * settle budget via {@link IPipelineBankConfig.loginCompletionPoll}. A bank
 * that did NOT opt in polls once (single-shot, zero wait) and ALWAYS
 * succeeds — byte-identical to today, zero added wall-time — so a slow but
 * healthy login can never be failed by this gate. Only an opted-in bank
 * (e.g. a perpetually-spinning Angular login) fails — non-retryably — when
 * the poll budget is exhausted without the form leaving the screen.
 *
 * <p>FORM-FIRST settle key: the primary "did login finish?" signal is "is
 * the filled login form still on screen?", read by re-using the already-
 * discovered password target (no new CSS selector). A stuck login keeps the
 * form mounted with no error and an unchanged URL, so the poll exhausts.
 *
 * <p>Strictly LOGIN-LOCAL (never probes a dashboard well-known — that is
 * AUTH-DISCOVERY's axis per the phase map's 100% separation rule) and
 * error-isolated: any throw yields a neutral success so a probe fault can
 * never break a healthy login.
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { LOGIN_NOT_COMPLETED_CODE } from '../../Types/Domain/LoginTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import {
  type ICompletionPollOptions,
  type ICompletionPollOutcome,
  pollCompletion,
} from '../Completion/CompletionPoll.js';
import type { ICompletionSignals } from '../Completion/CompletionTypes.js';
import { logCompletion, logCompletionError, makeAttemptLogger } from './LoginCompletionLog.js';
import { buildLoginCompletionPorts } from './LoginCompletionPorts.js';
import { checkLoginPostGates } from './PostValidate/PostValidateGates.js';

/** Neutral snapshot returned when the page cannot be observed. */
const NEUTRAL_COMPLETION: ICompletionSignals = {
  spinnerVisible: false,
  hasError: false,
  advanced: false,
  formPresent: false,
};

/** Blind outcome when the page cannot be observed — settled ⇒ never fails. */
const NEUTRAL_OUTCOME: ICompletionPollOutcome = {
  settled: true,
  attempts: 1,
  waitedMs: 0,
  last: NEUTRAL_COMPLETION,
};

/** Default poll budget: one capture, zero wait (byte-identical to today). */
const SINGLE_SHOT_POLL = { intervalMs: 0, maxAttempts: 1 } as const;

/**
 * Wait the given milliseconds via the canonical node timers promise — an
 * unref'd, lint-clean wait that satisfies the poll's sleep contract.
 * @param ms - Milliseconds to wait.
 * @returns Resolves after the wait.
 */
async function pollSleep(ms: number): Promise<void> {
  await setTimeoutPromise(ms, undefined, { ref: false });
}

/**
 * Resolve the completion-poll options from the bank config, defaulting to
 * single-shot when the bank did not opt into a settle budget.
 * @param input - Pipeline context carrying the bank config.
 * @returns Poll options with the canonical sleep injected.
 */
function resolvePollOptions(input: IPipelineContext): ICompletionPollOptions {
  const budget = input.config.loginCompletionPoll ?? SINGLE_SHOT_POLL;
  return {
    intervalMs: budget.intervalMs,
    maxAttempts: budget.maxAttempts,
    sleep: pollSleep,
    onAttempt: makeAttemptLogger(input, budget.maxAttempts),
  };
}

/**
 * Poll the login-completion ports for the active frame. Returns a blind
 * settled outcome when the mediator is unavailable (never fails).
 * @param input - Pipeline context (mediator + config).
 * @param frame - Active login frame from the post-gate.
 * @returns The completion poll outcome.
 */
async function captureOutcome(
  input: IPipelineContext,
  frame: Page | Frame,
): Promise<ICompletionPollOutcome> {
  if (!input.mediator.has) return NEUTRAL_OUTCOME;
  const ports = buildLoginCompletionPorts({ mediator: input.mediator.value, input, frame });
  const options = resolvePollOptions(input);
  return pollCompletion(ports, options);
}

/**
 * Build the non-retryable fail message for an exhausted settle poll.
 * @param outcome - The exhausted poll outcome.
 * @returns Fail message embedding the stable {@link LOGIN_NOT_COMPLETED_CODE}.
 */
function buildNotCompletedMessage(outcome: ICompletionPollOutcome): string {
  const detail = `${String(outcome.attempts)} attempts (${String(outcome.waitedMs)}ms)`;
  return `${LOGIN_NOT_COMPLETED_CODE} — login form still present after ${detail}`;
}

/**
 * Decide the LOGIN.final verdict from the poll outcome. NEUTRAL unless the
 * bank opted into a settle budget: a non-opted bank always succeeds; an
 * opted-in bank fails only when the budget is exhausted unsettled.
 * @param input - Pipeline context (config + pass-through value).
 * @param outcome - The completion poll outcome.
 * @returns Success (neutral / settled) or a non-retryable fail.
 */
function decideCompletion(
  input: IPipelineContext,
  outcome: ICompletionPollOutcome,
): Procedure<IPipelineContext> {
  const isEnforced = input.config.loginCompletionPoll !== undefined;
  if (!isEnforced || outcome.settled) return succeed(input);
  const message = buildNotCompletedMessage(outcome);
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Capture the login-completion outcome from the live page and decide the
 * verdict. Returns a neutral success when the post-gate prerequisites are
 * not met (nothing to observe).
 * @param input - Pipeline context at LOGIN.final.
 * @returns The completion verdict Procedure.
 */
async function captureLoginCompletion(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const ready = checkLoginPostGates(input);
  if (ready.tag === 'fail') return succeed(input);
  const outcome = await captureOutcome(input, ready.activeFrame);
  logCompletion(input, outcome);
  return decideCompletion(input, outcome);
}

/**
 * Enforce login completion at LOGIN.final — NEUTRAL unless the bank opted
 * into a settle budget. Error-isolated: any throw yields a neutral success
 * so a probe fault never breaks a healthy login.
 * @param input - Pipeline context at LOGIN.final.
 * @returns Success (neutral / settled) or a non-retryable fail.
 */
async function enforceLoginCompletion(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  try {
    return await captureLoginCompletion(input);
  } catch (error) {
    logCompletionError(input, error);
    return succeed(input);
  }
}

export default enforceLoginCompletion;
export { enforceLoginCompletion };
