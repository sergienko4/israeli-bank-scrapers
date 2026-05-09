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

import { pollWithBudget } from '../../../../../Scrapers/Pipeline/Mediator/Timing/PollWithBudget.js';

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
    const start = Date.now();
    const didHit = await pollWithBudget({
      probe,
      intervalMs: 50,
      budgetMs: 1000,
    });
    const elapsed = Date.now() - start;
    expect(didHit).toBe('hit');
    expect(calls).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(500);
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
      intervalMs: 0,
      budgetMs: 100,
    });
    expect(didHit).toBe(false);
    // Even with intervalMs=0 (clamped to 1), cannot exceed ~100 calls
    // in 100ms window thanks to setTimeout queue overhead.
    expect(calls).toBeLessThan(500);
  });
});
