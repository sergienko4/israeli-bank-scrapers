/**
 * Timer-leak invariant gate — the regression net for the retention-leak class
 * that caused the production OOM investigated in PR #449.
 *
 * <p>Every defect in that class had the same shape: a `setTimeout` handle was
 * discarded, so the timer stayed armed for its whole budget after the work it
 * guarded had already settled. An armed timer keeps the Node event loop alive
 * AND holds its callback closure reachable — and those closures captured
 * Playwright `Page`/`Locator` handles and whole browser objects.
 *
 * <p>These tests assert the invariant directly rather than the fix: after any
 * timing entry point settles, `jest.getTimerCount()` must be zero. That makes
 * the gate outlive the specific implementations — a future refactor that
 * reintroduces a discarded handle fails here even if it looks nothing like the
 * code these tests were written against.
 *
 * <p>Scope note: `raceTimeout`/`timeoutPromise` have their own dedicated cases
 * in `RaceTimeoutCancellation.test.ts`. This file covers the *consumers* that
 * previously hand-rolled their own timeout machinery, plus the bare delay
 * primitives, so no timer owner in the Timing cluster is left unasserted.
 */

import { jest } from '@jest/globals';

import executeFillAction from '../../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.Fill.js';
import { runAllCleanups } from '../../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js';
import { TERMINATE_CLEANUP_BUDGET_MS } from '../../../../../Scrapers/Pipeline/Mediator/Timing/TerminateTimingConfig.js';
import {
  humanDelay,
  sleep as delayFor,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';
import { waitUntil } from '../../../../../Scrapers/Pipeline/Mediator/Timing/Waiting.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeFlushableLogger } from '../../Infrastructure/TestHelpers.js';

const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 50;
const SLEEP_MS = 25;
const HUMAN_DELAY_MIN_MS = 30;
const HUMAN_DELAY_MAX_MS = 40;
/** Enough ticks past the deadline to prove the poll stopped re-arming. */
const OVERRUN_MS = POLL_TIMEOUT_MS + POLL_INTERVAL_MS * 5;
/** Long enough that a leaked OTP timer is unmistakably still armed. */
const OTP_BUDGET_MS = 120_000;

/** Shared logger stub — carries `flush`, which the OTP settle step calls. */
const NOOP_LOGGER = makeFlushableLogger();

/** A predicate plus the number of times it has been consulted. */
interface ICountingPredicate {
  readonly asyncTest: () => Promise<boolean>;
  readonly polls: () => number;
}

/**
 * Build a predicate that never succeeds and counts how often it ran, so a
 * poll loop that keeps re-arming after its race ended is observable.
 * @returns The predicate plus its call counter.
 */
function makeNeverTruePredicate(): ICountingPredicate {
  let count = 0;
  /**
   * Record the poll and report "not ready yet".
   * @returns Always false.
   */
  const asyncTest = (): Promise<boolean> => {
    count += 1;
    return Promise.resolve(false);
  };
  /**
   * Read the recorded poll count.
   * @returns Number of predicate invocations so far.
   */
  const polls = (): number => count;
  return { asyncTest, polls };
}

/**
 * A cleanup that settles immediately — the normal TERMINATE path, where the
 * budget timer must never outlive the cleanup it guarded.
 * @returns Successful cleanup procedure.
 */
function makeInstantCleanup(): Promise<Procedure<void>> {
  const result = succeed(undefined);
  return Promise.resolve(result);
}

/**
 * A cleanup that never settles, forcing the budget arm of the race to win.
 * @returns A forever-pending cleanup procedure.
 */
function makeHungCleanup(): Promise<Procedure<void>> {
  return new Promise<Procedure<void>>((): boolean => true);
}

/**
 * Build a predicate whose promise never settles, so the timeout always wins
 * while a poll is still in flight. Cancelling mid-predicate is the one case
 * the loop cannot short-circuit synchronously, so assert it explicitly.
 * @returns The hanging predicate plus its call counter.
 */
function makeHangingPredicate(): ICountingPredicate {
  let count = 0;
  /**
   * Record the poll and never settle.
   * @returns A forever-pending promise.
   */
  const asyncTest = (): Promise<boolean> => {
    count += 1;
    return new Promise<boolean>((): boolean => true);
  };
  /**
   * Read the recorded poll count.
   * @returns Number of predicate invocations so far.
   */
  const polls = (): number => count;
  return { asyncTest, polls };
}

/**
 * Build the minimum action context `executeFillAction` needs to reach its
 * retriever race.
 *
 * <p>`otpInputTarget` is deliberately absent from diagnostics, so the flow
 * returns a clean failure right after the race instead of driving a fill.
 * The timer invariant is what matters here, not the action's verdict.
 * @param retriever - Stand-in for the caller-supplied OTP retriever.
 * @returns A context accepted by the real OTP fill action.
 */
function makeOtpContext(retriever: () => Promise<string>): IActionContext {
  /** Sealed executor stub — only the pre-retriever settle is reached. */
  const executor = {
    /**
     * Settle instantly so the retriever race starts without delay.
     * @returns Always true.
     */
    waitForNetworkIdle: (): Promise<boolean> => Promise.resolve(true),
  };
  const options = { otpCodeRetriever: retriever, otpTimeoutMs: OTP_BUDGET_MS };
  const executorSlot = { has: true, value: executor };
  const diagnostics = { lastAction: '' };
  const context = { executor: executorSlot, diagnostics, options, logger: NOOP_LOGGER };
  return context as unknown as IActionContext;
}

describe('timer-leak invariants', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  it('T-LEAK-1 — waitUntil leaves no timer armed on the success path', async () => {
    const pending = waitUntil((): Promise<boolean> => Promise.resolve(true), 'ready');
    await expect(pending).resolves.toBe(true);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-2 — waitUntil leaves no timer armed once its timeout wins', async () => {
    const predicate = makeNeverTruePredicate();
    const opts = { timeout: POLL_TIMEOUT_MS, interval: POLL_INTERVAL_MS };
    const pending = waitUntil(predicate.asyncTest, 'never', opts);
    const rejection = expect(pending).rejects.toThrow('never');
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await rejection;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-3 — waitUntil stops polling once its timeout wins', async () => {
    const predicate = makeNeverTruePredicate();
    const opts = { timeout: POLL_TIMEOUT_MS, interval: POLL_INTERVAL_MS };
    const pending = waitUntil(predicate.asyncTest, 'never', opts);
    const rejection = expect(pending).rejects.toThrow('never');
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await rejection;
    const pollsAtTimeout = predicate.polls();
    await jest.advanceTimersByTimeAsync(OVERRUN_MS);
    const pollsAfterOverrun = predicate.polls();
    expect(pollsAfterOverrun).toBe(pollsAtTimeout);
  });

  it('T-LEAK-4 — runAllCleanups leaves no budget timer armed after a fast cleanup', async () => {
    const succeeded = await runAllCleanups([makeInstantCleanup], NOOP_LOGGER);
    expect(succeeded).toBe(1);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-5 — runAllCleanups leaves no timer armed after its budget elapses', async () => {
    const pending = runAllCleanups([makeHungCleanup], NOOP_LOGGER);
    await jest.advanceTimersByTimeAsync(TERMINATE_CLEANUP_BUDGET_MS);
    await expect(pending).resolves.toBe(0);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-6 — sleep leaves no timer armed once it resolves', async () => {
    const pending = delayFor(SLEEP_MS);
    await jest.advanceTimersByTimeAsync(SLEEP_MS);
    await expect(pending).resolves.toBe(true);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-7 — humanDelay leaves no timer armed once it resolves', async () => {
    const pending = humanDelay(HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
    await jest.advanceTimersByTimeAsync(HUMAN_DELAY_MAX_MS);
    await pending;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-8 — OTP fill leaves no timer armed when the retriever answers fast', async () => {
    /**
     * Answer immediately, the way an already-delivered code would.
     * @returns The OTP code.
     */
    const retriever = (): Promise<string> => Promise.resolve('123456');
    const context = makeOtpContext(retriever);
    const verdict = await executeFillAction(context);
    expect(verdict.success).toBe(false);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-9 — OTP fill leaves no timer armed once its budget wins', async () => {
    /**
     * Never answer, forcing the OTP budget arm to win the race.
     * @returns A forever-pending promise.
     */
    const retriever = (): Promise<string> => new Promise<string>((): boolean => true);
    const context = makeOtpContext(retriever);
    const pending = executeFillAction(context);
    await jest.advanceTimersByTimeAsync(OTP_BUDGET_MS);
    const verdict = await pending;
    expect(verdict.success).toBe(false);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-10 — waitUntil stops a poll that was in flight when its timeout won', async () => {
    const predicate = makeHangingPredicate();
    const opts = { timeout: POLL_TIMEOUT_MS, interval: POLL_INTERVAL_MS };
    const pending = waitUntil(predicate.asyncTest, 'hung', opts);
    const rejection = expect(pending).rejects.toThrow('hung');
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await rejection;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
    await jest.advanceTimersByTimeAsync(OVERRUN_MS);
    const pollsAfterOverrun = predicate.polls();
    expect(pollsAfterOverrun).toBe(1);
  });
});
