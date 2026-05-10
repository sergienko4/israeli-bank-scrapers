/**
 * Unit tests for `pollWithBudget` — the TIMING-mission utility that
 * replaces fixed-budget waits with poll-with-budget early-exit.
 *
 * Cases:
 * 1. Probe truthy on iteration 0 → returns synchronously.
 * 2. Probe truthy on iteration N → returns after N intervals.
 * 3. All probes false → returns false at budget elapse.
 * 4. Probe rejection on iteration N → treated as false; iteration
 *    N+1 still runs.
 * 5. Caller passes `intervalMs = 0` → defensively clamped to 1; no
 *    tight loop.
 */

import { jest } from '@jest/globals';

import { pollWithBudget } from '../../../../../Scrapers/Pipeline/Mediator/Timing/PollWithBudget.js';
import { createPromise } from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';

describe('pollWithBudget', () => {
  it('returns the probe result synchronously when truthy on iteration 0', async () => {
    /**
     * Probe truthy immediately.
     *
     * @returns Resolved 'hit'.
     */
    const probe = (): Promise<string | false> => Promise.resolve('hit');
    const didHit = await pollWithBudget({
      probe,
      intervalMs: 250,
      budgetMs: 5000,
    });
    expect(didHit).toBe('hit');
  });

  it('returns the probe result after N intervals when truthy on iteration N', async () => {
    // PR #221 review finding B.3: this case previously asserted
    // `elapsed >= 100ms && elapsed < 500ms` against the real wall
    // clock, which is flaky in CI under host scheduling/queue load.
    // Now uses Jest fake timers so the assertion targets call-count
    // determinism, not host-scheduling timing.
    jest.useFakeTimers();
    try {
      let calls = 0;
      /**
       * Probe returns false twice, then truthy on the 3rd call.
       *
       * @returns false twice, then 'hit' on call 3.
       */
      const probe = (): Promise<string | false> => {
        calls += 1;
        return Promise.resolve(calls < 3 ? false : 'hit');
      };
      const pending = pollWithBudget({
        probe,
        intervalMs: 50,
        budgetMs: 1000,
      });
      // Advance past 2 intervals (100ms) so the 3rd probe runs.
      await jest.advanceTimersByTimeAsync(200);
      const didHit = await pending;
      expect(didHit).toBe('hit');
      expect(calls).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns false when all probes return false within the budget', async () => {
    let calls = 0;
    /**
     * Probe always false.
     *
     * @returns Always false.
     */
    const probe = (): Promise<false> => {
      calls += 1;
      return Promise.resolve(false);
    };
    const didHit = await pollWithBudget({
      probe,
      intervalMs: 30,
      budgetMs: 200,
    });
    expect(didHit).toBe(false);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('absorbs probe rejection as false and keeps polling', async () => {
    let calls = 0;
    /**
     * Probe rejects on call 1, returns truthy on call 2.
     *
     * @returns Rejection then 'hit'.
     */
    const probe = (): Promise<string | false> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('first call rejection'));
      return Promise.resolve('hit');
    };
    const didHit = await pollWithBudget({
      probe,
      intervalMs: 30,
      budgetMs: 1000,
    });
    expect(didHit).toBe('hit');
    expect(calls).toBe(2);
  });

  it('clamps intervalMs=0 defensively to avoid tight loops', async () => {
    // PR #221 review finding B.3: previously this assertion ran on
    // the real clock (`expect(calls).toBeLessThan(500)`) which is
    // host-scheduling-dependent. Under fake timers we deterministically
    // advance the clock by exactly the budget and assert a non-tight
    // call rate (clamped intervalMs=1 → at most budgetMs+1 calls).
    jest.useFakeTimers();
    try {
      let calls = 0;
      /**
       * Probe always false.
       *
       * @returns Always false.
       */
      const probe = (): Promise<false> => {
        calls += 1;
        return Promise.resolve(false);
      };
      const pending = pollWithBudget({
        probe,
        intervalMs: 0,
        budgetMs: 100,
      });
      // Advance past the full budget so the deadline-guard fires.
      await jest.advanceTimersByTimeAsync(150);
      const didHit = await pending;
      expect(didHit).toBe(false);
      // Clamped intervalMs=1 means at most ~budgetMs+1 calls under
      // fake timers (one per advanced ms tick). Well below 500.
      expect(calls).toBeLessThan(500);
    } finally {
      jest.useRealTimers();
    }
  });

  it('B.2 — returns false immediately when budgetMs is exactly 0 (no probe call)', async () => {
    // PR #221 review finding B.2: today the deadline computed from
    // `Date.now() + budgetMs` lands at "now" or in the past when
    // budgetMs <= 0, but the probe still runs and can return truthy
    // before the timeout callback fires. That violates the contract
    // "returns false once exceeded" for exhausted budgets.
    let probeCalls = 0;
    /**
     * Probe that would return truthy if invoked. Guarded by the
     * budgetMs<=0 short-circuit — must not be called.
     *
     * @returns Truthy 'should-not-be-returned' (caught by assertion).
     */
    const probe = (): Promise<string | false> => {
      probeCalls += 1;
      return Promise.resolve('should-not-be-returned');
    };
    const result = await pollWithBudget({
      probe,
      intervalMs: 50,
      budgetMs: 0,
    });
    expect(result).toBe(false);
    expect(probeCalls).toBe(0);
  });

  it('B.2 — returns false immediately when budgetMs is negative (no probe call)', async () => {
    // Same contract for negative budgets. PR #221 review finding B.2.
    let probeCalls = 0;
    /**
     * Probe that would return truthy if invoked. Guarded.
     *
     * @returns Truthy 'should-not-be-returned'.
     */
    const probe = (): Promise<string | false> => {
      probeCalls += 1;
      return Promise.resolve('should-not-be-returned');
    };
    const result = await pollWithBudget({
      probe,
      intervalMs: 50,
      budgetMs: -1,
    });
    expect(result).toBe(false);
    expect(probeCalls).toBe(0);
  });

  it('B.1 — does not leak deadline-guard timers when probe wins (Promise.race cancellation)', async () => {
    // PR #221 review finding B.1: today the deadline guard creates
    // one setTimeout per probe race, but none are cancelled when
    // probeCall wins the race. Under frequent polling this
    // accumulates pending timers. Use fake timers to assert the
    // count drops to 0 after pollWithBudget resolves.
    jest.useFakeTimers();
    try {
      let calls = 0;
      /**
       * Probe returns false twice, then truthy on the 3rd call.
       * Drives 3 deadline-guard races inside pollLoop.
       *
       * @returns false twice, then 'hit'.
       */
      const probe = (): Promise<string | false> => {
        calls += 1;
        if (calls < 3) return Promise.resolve(false);
        return Promise.resolve('hit');
      };
      const pending = pollWithBudget({
        probe,
        intervalMs: 10,
        budgetMs: 10_000,
      });
      // Drive the recursion to completion under fake clock.
      await jest.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(result).toBe('hit');
      // No leftover deadline-guard timers should remain after probe wins.
      const remainingTimerCount = jest.getTimerCount();
      expect(remainingTimerCount).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps a hung probe via deadline guard (probe never resolves)', async () => {
    // Probe-hang protection: when a probe returns a Promise that never
    // resolves, the deadline-guard race must fire and pollWithBudget
    // must return false at budget elapse — never stalling forever.
    // This exercises the deadline-guard `setTimeout` callback +
    // `realResolve` arrow which the other tests do not (their probes
    // resolve synchronously and `cancel()` clears the guard).
    jest.useFakeTimers();
    try {
      let probeStarts = 0;
      /**
       * Probe that returns a Promise which never resolves. Drives
       * the deadline guard to win the race.
       *
       * @returns Pending Promise (never resolves).
       */
      const hungProbe = (): Promise<string | false> => {
        probeStarts += 1;
        return createPromise<string | false>((): boolean => true);
      };
      const pending = pollWithBudget({
        probe: hungProbe,
        intervalMs: 50,
        budgetMs: 200,
      });
      // Advance past the budget — deadline guard fires.
      await jest.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(result).toBe(false);
      expect(probeStarts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
