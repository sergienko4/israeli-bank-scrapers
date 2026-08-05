/**
 * Unit tests for WaitTickFactory — builds cancellable polling loops for waitUntil.
 */

import { jest } from '@jest/globals';

import { buildWaitPromise } from '../../../../../Scrapers/Pipeline/Mediator/Timing/WaitTickFactory.js';

/** Poll interval used by the cancellation suite. */
const POLL_MS = 1;

/** Virtual time to advance so several poll ticks elapse. */
const SETTLE_MS = 20;

/** Minimum poll count proving the loop actually ran before cancellation. */
const MIN_POLLS = 1;

/** A never-truthy predicate paired with a live read of its invocation count. */
interface ICountingTest {
  /** Never-truthy predicate that counts its invocations. */
  readonly asyncTest: () => Promise<boolean>;
  /** Live read of how many times the predicate has run. */
  readonly calls: () => number;
}

/**
 * Build a never-truthy predicate plus a live read of its invocation count.
 * @returns The predicate and a counter reader.
 */
function makeCountingTest(): ICountingTest {
  let calls = 0;
  /**
   * Never-truthy predicate that counts its invocations.
   * @returns Always false.
   */
  const asyncTest = (): Promise<boolean> => {
    calls += 1;
    return Promise.resolve(false);
  };
  /**
   * Read the current invocation count.
   * @returns Number of predicate invocations so far.
   */
  const calledTimes = (): number => calls;
  return { asyncTest, calls: calledTimes };
}

describe('buildWaitPromise', () => {
  it('resolves with the first truthy value from asyncTest', async () => {
    let counter = 0;
    /**
     * Async test that returns truthy on the second call.
     * @returns 0, then 42.
     */
    const asyncTest = (): Promise<number> => {
      counter += 1;
      if (counter < 2) return Promise.resolve(0);
      return Promise.resolve(42);
    };
    const poll = buildWaitPromise(asyncTest, POLL_MS);
    const resolved = await poll.promise;
    poll.cancel();
    expect(resolved).toBe(42);
  });

  it('keeps polling until truthy when initial results are falsy', async () => {
    const values = [false, false, true];
    let idx = 0;
    /**
     * Async predicate cycling through a values array.
     * @returns Next queued value.
     */
    const asyncTest = (): Promise<boolean> => {
      const isHit = values[idx] ?? false;
      idx += 1;
      return Promise.resolve(isHit);
    };
    const poll = buildWaitPromise(asyncTest, POLL_MS);
    const isResolved = await poll.promise;
    poll.cancel();
    expect(isResolved).toBe(true);
  });

  it('rejects when asyncTest throws', async () => {
    /**
     * Always rejects to trigger reject callback.
     * @returns Rejected promise.
     */
    const asyncTest = (): Promise<boolean> => Promise.reject(new Error('fail'));
    const poll = buildWaitPromise(asyncTest, POLL_MS);
    await expect(poll.promise).rejects.toThrow();
    poll.cancel();
  });

  it('accepts string truthy values', async () => {
    /**
     * Return non-empty string.
     * @returns The string 'hit'.
     */
    const asyncTest = (): Promise<string> => Promise.resolve('hit');
    const poll = buildWaitPromise(asyncTest, POLL_MS);
    const resolved = await poll.promise;
    poll.cancel();
    expect(resolved).toBe('hit');
  });
});

/**
 * Regression suite for the retention leak: an uncancelled poll kept re-arming
 * forever once its consumer had given up, so the Playwright handles its
 * predicate closed over stayed reachable for the rest of the run. Fake timers
 * make the tick count deterministic instead of wall-clock dependent.
 */
describe('buildWaitPromise cancellation', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  it('T-POLL-1 — polls repeatedly while it is still running', async () => {
    const counting = makeCountingTest();
    const poll = buildWaitPromise(counting.asyncTest, POLL_MS);
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    poll.cancel();
    const polled = counting.calls();
    expect(polled).toBeGreaterThan(MIN_POLLS);
  });

  it('T-POLL-2 — stops invoking asyncTest after cancel', async () => {
    const counting = makeCountingTest();
    const poll = buildWaitPromise(counting.asyncTest, POLL_MS);
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    poll.cancel();
    const atCancel = counting.calls();
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    const afterCancel = counting.calls();
    expect(afterCancel).toBe(atCancel);
  });

  it('T-POLL-3 — leaves no pending timer behind after cancel', async () => {
    const counting = makeCountingTest();
    const poll = buildWaitPromise(counting.asyncTest, POLL_MS);
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    poll.cancel();
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-POLL-4 — reports whether cancel cleared an armed timer', async () => {
    const counting = makeCountingTest();
    const poll = buildWaitPromise(counting.asyncTest, POLL_MS);
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    const didClearFirst = poll.cancel();
    const didClearAgain = poll.cancel();
    expect(didClearFirst).toBe(true);
    expect(didClearAgain).toBe(false);
  });
});
