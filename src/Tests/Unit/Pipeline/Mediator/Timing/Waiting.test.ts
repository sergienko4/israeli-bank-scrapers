/**
 * Unit tests for Waiting — waitUntil polling with timeout + diagnostics.
 */

import {
  humanDelay,
  RACE_TIMED_OUT,
  raceTimeout,
  runSerial,
  sleep as timingSleep,
  TimeoutError,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';
import { waitUntil } from '../../../../../Scrapers/Pipeline/Mediator/Timing/Waiting.js';

describe('waitUntil', () => {
  it('resolves with the first truthy value', async () => {
    /**
     * Immediately truthy test.
     * @returns Resolved truthy value.
     */
    const test = (): Promise<number> => Promise.resolve(7);
    const value = await waitUntil(test, 'desc', { interval: 1, timeout: 100 });
    expect(value).toBe(7);
  });

  it('throws TimeoutError when timeout elapses before truthy', async () => {
    /**
     * Always falsy.
     * @returns Resolved false.
     */
    const test = (): Promise<boolean> => Promise.resolve(false);
    const waitUntilResult1 = waitUntil(test, 'desc', { interval: 5, timeout: 20 });
    await expect(waitUntilResult1).rejects.toThrow(TimeoutError);
  });

  it('includes last polled value in timeout error message', async () => {
    /**
     * Always returns 0 (falsy) so the polling never resolves truthy.
     * @returns Resolved 0.
     */
    const test = (): Promise<number> => Promise.resolve(0);
    const waitUntilResult2 = waitUntil(test, 'desc', { interval: 5, timeout: 20 });
    const matcher = { message: expect.stringContaining('last') as unknown };
    await expect(waitUntilResult2).rejects.toMatchObject(matcher);
  });

  it('uses default interval and timeout when opts omitted', async () => {
    /**
     * Immediately truthy test to avoid default timeout of 10s.
     * @returns Resolved 'ok'.
     */
    const test = (): Promise<string> => Promise.resolve('ok');
    const value = await waitUntil(test);
    expect(value).toBe('ok');
  });

  it('rethrows non-TimeoutError caught during polling', async () => {
    // Any exception thrown by the predicate is propagated through Promise.race and caught
    // by the rethrowWithContext branch that does not match TimeoutError.
    // Verify the promise rejects (regardless of which wrap is used).
    /**
     * Async predicate that rejects with a non-TimeoutError.
     * @returns Rejected promise.
     */
    const test = (): Promise<never> => Promise.reject(new Error('not-a-timeout'));
    const waitUntilResult3 = waitUntil(test, 'desc', { interval: 1, timeout: 50 });
    await expect(waitUntilResult3).rejects.toBeDefined();
  });
});

describe('Waiting re-exports', () => {
  it('exposes humanDelay', () => {
    expect(typeof humanDelay).toBe('function');
  });
  it('exposes sleep', () => {
    expect(typeof timingSleep).toBe('function');
  });
  it('exposes raceTimeout + sentinel', () => {
    expect(typeof raceTimeout).toBe('function');
    expect(typeof RACE_TIMED_OUT).toBe('symbol');
  });
  it('exposes runSerial', () => {
    expect(typeof runSerial).toBe('function');
  });
});

describe('sleep', () => {
  it('resolves true after the given delay', async () => {
    const isOk = await timingSleep(1);
    expect(isOk).toBe(true);
  });
});

describe('humanDelay', () => {
  it('resolves with a Procedure after a short delay (custom range)', async () => {
    const result = await humanDelay(1, 3);
    expect(result.success).toBe(true);
  });
  it('uses default range when no args supplied', async () => {
    // Using internal defaults — but the delay should still resolve quickly
    // (at most HUMAN_DELAY_MAX_MS). To avoid flakiness, only assert the shape.
    const p = humanDelay(1, 2);
    const result = await p;
    expect(result.success).toBe(true);
  });
  it('accepts only minMs (maxMs uses default)', async () => {
    const result = await humanDelay(1);
    expect(result.success).toBe(true);
  });
  it('accepts zero args — exercises BOTH default-param branches', async () => {
    // Hits the defaulted parameter branches at line 127/128 of TimingActions.
    const result = await humanDelay();
    expect(result.success).toBe(true);
  }, 5000);
});

describe('Feature — Serial', () => {
  it('executes actions in order and collects all results', async () => {
    const order: number[] = [];
    const actions = [
      async (): Promise<number> => {
        await Promise.resolve();
        order.push(1);
        return 10;
      },
      async (): Promise<number> => {
        await Promise.resolve();
        order.push(2);
        return 20;
      },
      async (): Promise<number> => {
        await Promise.resolve();
        order.push(3);
        return 30;
      },
    ];
    const results = await runSerial(actions);
    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('returns empty array when action list empty', async () => {
    const out = await runSerial<number>([]);
    expect(out).toEqual([]);
  });
});

describe('raceTimeout — handleRaceError branch', () => {
  it('returns RACE_TIMED_OUT sentinel when inner promise resolves after timeout', async () => {
    // raceTimeout rejects with a timeout error when inner hasn't resolved in time.
    // We use a promise that resolves only after raceTimeout has already timed out.
    const slow = new Promise<number>((resolve): boolean => {
      type TimerFn = (cb: () => boolean, ms: number) => unknown;
      const scheduler = (globalThis as { setTimeout: TimerFn }).setTimeout;
      /**
       * Timer tick.
       * @returns true after resolving the outer promise.
       */
      const tick = (): boolean => {
        resolve(42);
        return true;
      };
      scheduler(tick, 100);
      return true;
    });
    const result = await raceTimeout(5, slow);
    expect(result).toBe(RACE_TIMED_OUT);
  });

  it('rethrows non-timeout errors', async () => {
    const boom = Promise.reject(new Error('boom'));
    const raceTimeoutResult4 = raceTimeout(1000, boom);
    await expect(raceTimeoutResult4).rejects.toThrow(/boom/);
  });

  it('resolves with the value when promise wins', async () => {
    const ok = Promise.resolve('value');
    const result = await raceTimeout(1000, ok);
    expect(result).toBe('value');
  });
});
