/**
 * Unit coverage for {@link pollCompletion} — the phase-agnostic completion
 * POLL. Proves the FORM-FIRST settle rule tracks ARBITRARY clear timing: the
 * poll keeps capturing while the filled form is present and settles the instant
 * it is gone (or the UI advanced / an error surfaced). Fixed AND randomized
 * clear-points prove the attempt count + waited-ms accounting is exact for any
 * timing; a stuck form proves the budget exhausts honestly; single-shot proves
 * the default zero-wait path. Sleep is INJECTED so timing is deterministic
 * (no real timers).
 */

import { jest } from '@jest/globals';

import {
  type ICompletionPollOptions,
  pollCompletion,
} from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionPoll.js';
import type { ICompletionPorts } from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionTypes.js';
import {
  LOGIN_COMPLETION_POLL_INTERVAL_MS,
  LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/LoginTimingConfig.js';

/** Optional attempt-1 settle overrides (advanced / error fire immediately). */
interface IEdge {
  readonly advanced?: boolean;
  readonly error?: boolean;
}

/** Scripted ports plus a handle to the spinner spy for call-count asserts. */
interface IScripted {
  readonly ports: ICompletionPorts;
  readonly spinner: jest.Mock;
}

/** One poll run: the outcome, the recorded sleeps, and the spinner spy. */
interface IRunResult {
  readonly outcome: Awaited<ReturnType<typeof pollCompletion>>;
  readonly sleeps: number[];
  readonly spinner: jest.Mock;
}

/**
 * Build completion ports whose form clears on the `clearAt`-th capture. The
 * form-present probe owns the shared attempt counter, so each capture advances
 * the clock exactly once; spinner/error/advanced are flat per run.
 * @param clearAt - 1-based attempt on which the form first reads gone.
 * @param edge - Optional attempt-1 advanced/error settle overrides.
 * @returns Scripted ports + the spinner spy.
 */
function makeScriptedPorts(clearAt: number, edge: IEdge = {}): IScripted {
  let attempt = 0;
  const spinner = jest.fn<Promise<boolean>, []>().mockResolvedValue(false);
  const ports: ICompletionPorts = {
    isSpinnerVisible: spinner,
    hasError: jest.fn<Promise<boolean>, []>().mockResolvedValue(edge.error === true),
    isFormPresent: jest.fn<Promise<boolean>, []>().mockImplementation((): Promise<boolean> => {
      attempt += 1;
      return Promise.resolve(attempt < clearAt);
    }),
    hasAdvanced: jest.fn<boolean, []>().mockReturnValue(edge.advanced === true),
  };
  return { ports, spinner };
}

/**
 * Run the poll with a counting injected sleep.
 * @param clearAt - Attempt on which the form clears.
 * @param maxAttempts - Poll budget.
 * @param edge - Optional immediate-settle overrides.
 * @returns The outcome, the recorded sleeps, and the spinner spy.
 */
async function runPoll(
  clearAt: number,
  maxAttempts: number,
  edge: IEdge = {},
): Promise<IRunResult> {
  const sleeps: number[] = [];
  /**
   * Record each injected poll wait without using a real timer.
   * @param ms - The interval the poll asked to wait.
   * @returns A resolved promise (deterministic, zero real delay).
   */
  const recordSleep = (ms: number): Promise<void> => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  const opts: ICompletionPollOptions = {
    intervalMs: LOGIN_COMPLETION_POLL_INTERVAL_MS,
    maxAttempts,
    sleep: recordSleep,
  };
  const { ports, spinner } = makeScriptedPorts(clearAt, edge);
  const outcome = await pollCompletion(ports, opts);
  return { outcome, sleeps, spinner };
}

/**
 * Assert the exact attempt/sleep accounting for a form-timing run.
 * @param res - The poll run result.
 * @param clearAt - The form's clear attempt.
 * @param maxAttempts - The poll budget.
 * @returns `true` once every timing invariant holds.
 */
function expectFormTiming(res: IRunResult, clearAt: number, maxAttempts: number): boolean {
  const attempts = Math.min(clearAt, maxAttempts);
  expect(res.outcome.attempts).toBe(attempts);
  expect(res.outcome.settled).toBe(clearAt <= maxAttempts);
  expect(res.outcome.waitedMs).toBe((attempts - 1) * LOGIN_COMPLETION_POLL_INTERVAL_MS);
  const expectedSleeps = Array.from(
    { length: attempts - 1 },
    (): number => LOGIN_COMPLETION_POLL_INTERVAL_MS,
  );
  expect(res.sleeps).toEqual(expectedSleeps);
  expect(res.spinner).toHaveBeenCalledTimes(attempts);
  expect(res.outcome.last.formPresent).toBe(!res.outcome.settled);
  return true;
}

/**
 * Assert an immediate (attempt-1) settle with no sleeps.
 * @param res - The poll run result.
 * @returns `true` once the immediate-settle invariant holds.
 */
function expectImmediateSettle(res: IRunResult): boolean {
  expect(res.outcome.settled).toBe(true);
  expect(res.outcome.attempts).toBe(1);
  expect(res.outcome.waitedMs).toBe(0);
  expect(res.sleeps).toEqual([]);
  expect(res.spinner).toHaveBeenCalledTimes(1);
  expect(res.outcome.last.formPresent).toBe(true);
  return true;
}

/**
 * A random 1..MAX clear-point — any value satisfies the same invariant.
 * @returns A poll attempt index in the inclusive range [1, MAX_ATTEMPTS].
 */
function randomClearAt(): number {
  return 1 + Math.floor(Math.random() * LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
}

const FIXED_CLEAR_POINTS = [2, 8, 14];
const RANDOM_CLEAR_POINTS = [randomClearAt(), randomClearAt(), randomClearAt()];
const STUCK_CLEAR_AT = LOGIN_COMPLETION_POLL_MAX_ATTEMPTS + 1;

describe('pollCompletion — FORM-FIRST settle timing', () => {
  it.each(FIXED_CLEAR_POINTS)(
    'fixed clear-point %i: settles with exact attempt + waited-ms accounting',
    async (clearAt: number): Promise<void> => {
      const res = await runPoll(clearAt, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
      expectFormTiming(res, clearAt, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
    },
  );

  // Randomized clear-points prove the poll tracks ARBITRARY timing, not just
  // the hand-picked fixed points. The asserted invariant holds for every value
  // in [1..MAX], so the random draw can never make the test flaky.
  it.each(RANDOM_CLEAR_POINTS)(
    'random clear-point %i: poll tracks arbitrary timing exactly',
    async (clearAt: number): Promise<void> => {
      const res = await runPoll(clearAt, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
      expectFormTiming(res, clearAt, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
    },
  );

  it('stuck form never clears → exhausts the budget, reports not settled', async () => {
    const res = await runPoll(STUCK_CLEAR_AT, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
    expectFormTiming(res, STUCK_CLEAR_AT, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS);
    expect(res.outcome.settled).toBe(false);
  });

  it('single-shot budget captures once and never sleeps', async () => {
    const res = await runPoll(STUCK_CLEAR_AT, 1);
    expectFormTiming(res, STUCK_CLEAR_AT, 1);
    expect(res.sleeps).toEqual([]);
  });

  it('advanced past start settles on attempt 1 (form still present)', async () => {
    const res = await runPoll(STUCK_CLEAR_AT, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS, {
      advanced: true,
    });
    expectImmediateSettle(res);
    expect(res.outcome.last.advanced).toBe(true);
  });

  it('error surfaced settles on attempt 1 (form still present)', async () => {
    const res = await runPoll(STUCK_CLEAR_AT, LOGIN_COMPLETION_POLL_MAX_ATTEMPTS, { error: true });
    expectImmediateSettle(res);
    expect(res.outcome.last.hasError).toBe(true);
  });
});
