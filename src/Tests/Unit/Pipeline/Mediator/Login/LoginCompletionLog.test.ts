/**
 * Unit coverage for {@link LoginCompletionLog} — the login-completion
 * telemetry facade. Proves: formSignals() drops spinnerVisible; logAttempt()
 * emits a well-shaped per-attempt line; makeAttemptLogger() returns a
 * working onAttempt callback; logCompletion() emits the final line with
 * settled/attempts/waitedMs but no spinnerVisible; logCompletionError()
 * logs error.name only, never the message or stack.
 */

import { jest } from '@jest/globals';

import type { ICompletionPollOutcome } from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionPoll.js';
import type { ICompletionSignals } from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionTypes.js';
import {
  formSignals,
  logAttempt,
  logCompletion,
  logCompletionError,
  makeAttemptLogger,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginCompletionLog.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Build a fake pipeline context with a captured debug spy.
 * @returns Object with a fake pipeline context and its debug spy.
 */
function makeInput(): { input: IPipelineContext; debug: jest.Mock } {
  const debug = jest.fn();
  const input = { logger: { debug } } as unknown as IPipelineContext;
  return { input, debug };
}

/** Build a full four-field signals snapshot (spinnerVisible included).
 * @param overrides - Optional partial overrides for any field.
 * @returns A full ICompletionSignals snapshot.
 */
function makeSignals(overrides: Partial<ICompletionSignals> = {}): ICompletionSignals {
  return {
    spinnerVisible: true,
    formPresent: true,
    advanced: false,
    hasError: false,
    ...overrides,
  };
}

/** Args bundle for {@link makeOutcome} — keeps calls within the 3-param ceiling. */
interface IMakeOutcomeArgs {
  readonly settled: boolean;
  readonly attempts: number;
  readonly waitedMs: number;
  readonly last: ICompletionSignals;
}

/**
 * Build a completion poll outcome for logCompletion assertions.
 * @param args - Outcome field bundle.
 * @returns A typed completion poll outcome.
 */
function makeOutcome(args: IMakeOutcomeArgs): ICompletionPollOutcome {
  return args;
}

describe('formSignals', () => {
  it('returns the three form fields only — spinnerVisible is absent', () => {
    const signals = makeSignals({
      spinnerVisible: true,
      formPresent: true,
      advanced: true,
      hasError: false,
    });
    const result = formSignals(signals);
    expect(result).toEqual({ formPresent: true, advanced: true, hasError: false });
    expect('spinnerVisible' in result).toBe(false);
  });

  it('works with spinnerVisible false — still absent from the projection', () => {
    const signals = makeSignals({ spinnerVisible: false, formPresent: false });
    const result = formSignals(signals);
    expect('spinnerVisible' in result).toBe(false);
    expect(result.formPresent).toBe(false);
  });
});

describe('logAttempt', () => {
  it('emits login.completion.attempt with attempt/of/formPresent/advanced/hasError', () => {
    const { input, debug } = makeInput();
    const signals = makeSignals({ spinnerVisible: true, formPresent: true });
    logAttempt({ input, attempt: 2, of: 5, signals });
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.attempt',
      attempt: 2,
      of: 5,
      formPresent: true,
      advanced: false,
      hasError: false,
    });
    const arg = (debug.mock.calls as [Record<string, unknown>][])[0][0];
    expect('spinnerVisible' in arg).toBe(false);
  });
});

describe('makeAttemptLogger', () => {
  it('returns a callback that emits the attempt line with correct attempt/of', () => {
    const { input, debug } = makeInput();
    const cb = makeAttemptLogger(input, 10);
    const signals = makeSignals({ formPresent: false, advanced: true });
    cb(7, signals);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.attempt',
      attempt: 7,
      of: 10,
      formPresent: false,
      advanced: true,
      hasError: false,
    });
  });
});

describe('logCompletion', () => {
  it('emits login.completion with settled/attempts/waitedMs/formPresent — no spinnerVisible', () => {
    const { input, debug } = makeInput();
    const last = makeSignals({ spinnerVisible: true, formPresent: false, advanced: true });
    const outcome = makeOutcome({ settled: true, attempts: 3, waitedMs: 10000, last });
    logCompletion(input, outcome);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion',
      settled: true,
      attempts: 3,
      waitedMs: 10000,
      formPresent: false,
      advanced: true,
      hasError: false,
    });
    const arg = (debug.mock.calls as [Record<string, unknown>][])[0][0];
    expect('spinnerVisible' in arg).toBe(false);
  });
});

describe('logCompletionError', () => {
  it('logs error.name only — not the message or stack', () => {
    const { input, debug } = makeInput();
    const err = new Error('secret PII in message');
    err.name = 'NetworkError';
    logCompletionError(input, err);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.error',
      error: 'NetworkError',
    });
  });

  it('uses "Unknown" for non-Error throws', () => {
    const { input, debug } = makeInput();
    logCompletionError(input, 'just a string');
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.error',
      error: 'Unknown',
    });
  });
});
