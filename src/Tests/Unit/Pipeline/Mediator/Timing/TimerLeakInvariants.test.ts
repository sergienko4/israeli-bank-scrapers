/**
 * Timer-leak invariant gate â€” the regression net for the retention-leak class
 * that caused the production OOM investigated in PR #449.
 *
 * <p>Every defect in that class had the same shape: a `setTimeout` handle was
 * discarded, so the timer stayed armed for its whole budget after the work it
 * guarded had already settled. An armed timer keeps the Node event loop alive
 * AND holds its callback closure reachable â€” and those closures captured
 * Playwright `Page`/`Locator` handles and whole browser objects.
 *
 * <p>These tests assert the invariant directly rather than the fix: after any
 * timing entry point settles, `jest.getTimerCount()` must be zero. That makes
 * the gate outlive the specific implementations â€” a future refactor that
 * reintroduces a discarded handle fails here even if it looks nothing like the
 * code these tests were written against.
 *
 * <p>Scope note: `raceTimeout`/`timeoutPromise` have their own dedicated cases
 * in `RaceTimeoutCancellation.test.ts`. This file covers the *consumers* that
 * previously hand-rolled their own timeout machinery, plus the bare delay
 * primitives, so no timer owner in the Timing cluster is left unasserted.
 */

import { jest } from '@jest/globals';

import { runAllCleanups } from '../../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js';
import {
  humanDelay,
  sleep as delayFor,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';
import { TERMINATE_CLEANUP_BUDGET_MS } from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingConfig.js';
import { waitUntil } from '../../../../../Scrapers/Pipeline/Mediator/Timing/Waiting.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 50;
const SLEEP_MS = 25;
const HUMAN_DELAY_MIN_MS = 30;
const HUMAN_DELAY_MAX_MS = 40;
/** Enough ticks past the deadline to prove the poll stopped re-arming. */
const OVERRUN_MS = POLL_TIMEOUT_MS + POLL_INTERVAL_MS * 5;

/** No-op logger stub matching the ScraperLogger surface. */
const NOOP_LOGGER: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

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
 * A cleanup that settles immediately â€” the normal TERMINATE path, where the
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

describe('timer-leak invariants', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  it('T-LEAK-1 â€” waitUntil leaves no timer armed on the success path', async () => {
    const pending = waitUntil((): Promise<boolean> => Promise.resolve(true), 'ready');
    await expect(pending).resolves.toBe(true);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-2 â€” waitUntil leaves no timer armed once its timeout wins', async () => {
    const predicate = makeNeverTruePredicate();
    const opts = { timeout: POLL_TIMEOUT_MS, interval: POLL_INTERVAL_MS };
    const pending = waitUntil(predicate.asyncTest, 'never', opts);
    const rejection = expect(pending).rejects.toThrow('never');
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await rejection;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-3 â€” waitUntil stops polling once its timeout wins', async () => {
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

  it('T-LEAK-4 â€” runAllCleanups leaves no budget timer armed after a fast cleanup', async () => {
    const succeeded = await runAllCleanups([makeInstantCleanup], NOOP_LOGGER);
    expect(succeeded).toBe(1);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-5 â€” runAllCleanups leaves no timer armed after its budget elapses', async () => {
    const pending = runAllCleanups([makeHungCleanup], NOOP_LOGGER);
    await jest.advanceTimersByTimeAsync(TERMINATE_CLEANUP_BUDGET_MS);
    await expect(pending).resolves.toBe(0);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-6 â€” sleep leaves no timer armed once it resolves', async () => {
    const pending = delayFor(SLEEP_MS);
    await jest.advanceTimersByTimeAsync(SLEEP_MS);
    await expect(pending).resolves.toBe(true);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-7 â€” humanDelay leaves no timer armed once it resolves', async () => {
    const pending = humanDelay(HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
    await jest.advanceTimersByTimeAsync(HUMAN_DELAY_MAX_MS);
    await pending;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });
});
