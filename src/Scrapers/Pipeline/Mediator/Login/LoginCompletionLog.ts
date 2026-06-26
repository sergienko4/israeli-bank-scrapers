/**
 * Login-completion telemetry facade — PII-safe per-attempt and final
 * log lines for LOGIN.final's form-presence settle poll.
 *
 * <p>Data-Mapper: {@link formSignals} projects the four-field
 * {@link ICompletionSignals} down to the three boolean form signals
 * (formPresent / advanced / hasError), DROPPING `spinnerVisible`.
 * The spinner reads `false` while Amex is visibly spinning — a
 * misleading signal that breaks CI diagnosis ("no wrong error").
 * Every logged field is a boolean or counter — inherently PII-free.
 *
 * <p>Extracted from LoginCompletionObserver per cap-honoring composition
 * (design-patterns P7/P8 + code-simplification): the telemetry concern
 * is separate from the settle/decide concern.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { ICompletionPollOutcome } from '../Completion/CompletionPoll.js';
import type { ICompletionSignals } from '../Completion/CompletionTypes.js';

/**
 * PII-safe form-signal projection — `spinnerVisible` deliberately
 * excluded (reads `false` while Amex spins; misleading in CI logs).
 */
type IFormSignals = Pick<ICompletionSignals, 'formPresent' | 'advanced' | 'hasError'>;

/**
 * Bundle for {@link logAttempt} — keeps every call-site within the
 * three-parameter ceiling (general-rules P6 / design-patterns P6).
 */
interface IAttemptLogArgs {
  readonly input: IPipelineContext;
  readonly attempt: number;
  readonly of: number;
  readonly signals: ICompletionSignals;
}

/**
 * Project the full signals down to three form-only booleans, dropping
 * `spinnerVisible` (unreliable — `false` while Amex spins).
 * @param signals - The full four-field completion signals snapshot.
 * @returns Three-field form-signals object.
 */
function formSignals(signals: ICompletionSignals): IFormSignals {
  return {
    formPresent: signals.formPresent,
    advanced: signals.advanced,
    hasError: signals.hasError,
  };
}

/**
 * Emit one `login.completion.attempt` debug line for a single poll
 * capture. All fields are booleans or counters — PII-free.
 * @param args - Bundled attempt metadata (context, attempt index, budget).
 * @returns True after emitting.
 */
function logAttempt(args: IAttemptLogArgs): true {
  args.input.logger.debug({
    phase: 'login',
    message: 'login.completion.attempt',
    attempt: args.attempt,
    of: args.of,
    ...formSignals(args.signals),
  });
  return true;
}

/**
 * Build the `onAttempt` callback injected into the poll options.
 * Each capture fires this so the attempt is visible in the log.
 * @param input - Pipeline context carrying the logger.
 * @param of - Poll budget (max attempts) for the `of` field.
 * @returns Callback matching `ICompletionPollOptions.onAttempt`.
 */
function makeAttemptLogger(
  input: IPipelineContext,
  of: number,
): (attempt: number, signals: ICompletionSignals) => true {
  return (attempt: number, signals: ICompletionSignals): true =>
    logAttempt({ input, attempt, of, signals });
}

/**
 * Build the structured `login.completion` log object, merging settled /
 * attempts / waitedMs with the form-only signal projection.
 * @param outcome - The completed poll outcome.
 * @returns Debug log object.
 */
function buildCompletionLine(outcome: ICompletionPollOutcome): Record<string, unknown> {
  return {
    phase: 'login',
    message: 'login.completion',
    settled: outcome.settled,
    attempts: outcome.attempts,
    waitedMs: outcome.waitedMs,
    ...formSignals(outcome.last),
  };
}

/**
 * Emit the final `login.completion` debug line from the poll outcome.
 * Adds settled/attempts/waitedMs summary; drops `spinnerVisible`.
 * @param input - Pipeline context carrying the logger.
 * @param outcome - The completed poll outcome.
 * @returns True after emitting.
 */
function logCompletion(input: IPipelineContext, outcome: ICompletionPollOutcome): true {
  const line = buildCompletionLine(outcome);
  input.logger.debug(line);
  return true;
}

/**
 * Emit `login.completion.error` when a probe throws. Logs
 * `error.name` only — never the message or stack (PII safety).
 * @param input - Pipeline context carrying the logger.
 * @param error - The thrown value.
 * @returns True after emitting.
 */
function logCompletionError(input: IPipelineContext, error: unknown): true {
  const name = error instanceof Error ? error.name : 'Unknown';
  input.logger.debug({ phase: 'login', message: 'login.completion.error', error: name });
  return true;
}

export type { IAttemptLogArgs, IFormSignals };
export { formSignals, logAttempt, logCompletion, logCompletionError, makeAttemptLogger };
