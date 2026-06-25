/**
 * ADVISORY login-completion observer — composes the four LOGIN-LOCAL
 * completion signals (spinner-gone / error-absent / advanced-past-login /
 * form-gone) into one observed snapshot at LOGIN.final, PII-safe-logs it,
 * and returns it for the caller to OBSERVE.
 *
 * <p>Advisory by contract: the phase DISCARDS the returned snapshot, so
 * wiring this into LOGIN.final changes ZERO behaviour for every bank. It
 * only instruments the perpetually-spinning-login case (a lenient cookie
 * gate falsely passes) so the signal is visible before any future
 * enforcing slice consumes it.
 *
 * <p>The snapshot is captured through a CONFIG-DRIVEN completion poll that
 * defaults to single-shot (one capture, zero wait) — byte-identical to a
 * direct capture and adding zero wall-time. A bank opts into a real
 * settle budget via {@link IPipelineBankConfig.loginCompletionPoll}.
 *
 * <p>Strictly LOGIN-LOCAL: it never probes a dashboard well-known (that is
 * AUTH-DISCOVERY's axis per the phase map's 100% separation rule). It is
 * error-isolated — any throw yields a neutral snapshot so the caller's
 * verdict is never perturbed, and it adds no `page.on()` listener
 * (pure probes, Camoufox fingerprint-safe).
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import type { Frame, Page } from 'playwright-core';

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { type ICompletionPollOptions, pollCompletion } from '../Completion/CompletionPoll.js';
import type { ICompletionSignals } from '../Completion/CompletionTypes.js';
import { buildLoginCompletionPorts } from './LoginCompletionPorts.js';
import { checkLoginPostGates } from './PostValidate/PostValidateGates.js';

/** Neutral snapshot returned when the page cannot be observed (advisory). */
const NEUTRAL_COMPLETION: ICompletionSignals = {
  spinnerVisible: false,
  hasError: false,
  advanced: false,
  formPresent: false,
};

/** Default poll budget: one capture, zero wait (byte-identical to today). */
const SINGLE_SHOT_POLL = { intervalMs: 0, maxAttempts: 1 } as const;

/**
 * Wait the given milliseconds via the canonical node timers promise — an
 * unref'd, lint-clean wait that satisfies the poll's void sleep contract.
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
  return { intervalMs: budget.intervalMs, maxAttempts: budget.maxAttempts, sleep: pollSleep };
}

/**
 * PII-safe advisory log of an observed login-completion snapshot. The three
 * fields are booleans — inherently free of personal data.
 * @param input - Pipeline context carrying the logger.
 * @param signals - The observed completion signals.
 * @returns The same signals, for caller pass-through.
 */
function logCompletion(input: IPipelineContext, signals: ICompletionSignals): ICompletionSignals {
  input.logger.debug({ phase: 'login', message: 'login.completion', ...signals });
  return signals;
}

/**
 * PII-safe advisory log when the observer cannot read the page. Logs only
 * the error name — never the message or stack.
 * @param input - Pipeline context carrying the logger.
 * @param error - The thrown value.
 * @returns The neutral snapshot, for caller pass-through.
 */
function logCompletionError(input: IPipelineContext, error: unknown): ICompletionSignals {
  const name = error instanceof Error ? error.name : 'Unknown';
  input.logger.debug({ phase: 'login', message: 'login.completion.error', error: name });
  return NEUTRAL_COMPLETION;
}

/**
 * Build the completion ports for the active frame and capture a snapshot.
 * Returns neutral when the mediator is unavailable.
 * @param input - Pipeline context (mediator + logger).
 * @param frame - Active login frame from the post-gate.
 * @returns The observed completion signals.
 */
async function captureFromFrame(
  input: IPipelineContext,
  frame: Page | Frame,
): Promise<ICompletionSignals> {
  if (!input.mediator.has) return NEUTRAL_COMPLETION;
  const ports = buildLoginCompletionPorts({ mediator: input.mediator.value, input, frame });
  const options = resolvePollOptions(input);
  const outcome = await pollCompletion(ports, options);
  return outcome.last;
}

/**
 * Capture the login-completion snapshot from the live page. Skips (returns
 * neutral) when the post-gate prerequisites are not met.
 * @param input - Pipeline context at LOGIN.final.
 * @returns The observed completion signals.
 */
async function captureLoginCompletion(input: IPipelineContext): Promise<ICompletionSignals> {
  const ready = checkLoginPostGates(input);
  if (ready.tag === 'fail') return NEUTRAL_COMPLETION;
  const signals = await captureFromFrame(input, ready.activeFrame);
  return logCompletion(input, signals);
}

/**
 * Observe login completion in ADVISORY mode — never throws, never changes
 * the phase verdict. On any error returns the neutral snapshot.
 * @param input - Pipeline context at LOGIN.final.
 * @returns The observed completion signals (neutral on failure).
 */
async function observeLoginCompletion(input: IPipelineContext): Promise<ICompletionSignals> {
  try {
    return await captureLoginCompletion(input);
  } catch (error) {
    return logCompletionError(input, error);
  }
}

export default observeLoginCompletion;
export { observeLoginCompletion };
