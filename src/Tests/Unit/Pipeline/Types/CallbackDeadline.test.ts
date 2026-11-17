/**
 * Caller callbacks are bounded: a settled callback resolves, and one that
 * outlives its budget rejects with a fixed error instead of holding the run.
 */

import { jest } from '@jest/globals';

import { runWithBankContext } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import withCallbackDeadline from '../../../../Scrapers/Pipeline/Types/CallbackDeadline.js';

/** Default callback budget the implementation and docs name. */
const DEFAULT_CALLBACK_TIMEOUT_MS = 30_000;

describe('withCallbackDeadline', () => {
  it('returns the callback result when it settles in time', async (): Promise<void> => {
    const work = Promise.resolve('stored');
    const result = await withCallbackDeadline(work, 50);
    expect(result).toBe('stored');
  });

  it.each([Number.NaN, -1])('uses the default budget for an unusable budget %s', async budget => {
    jest.useFakeTimers();
    try {
      const never = new Promise<string>(() => {
        // Never resolves: only the default budget may settle it.
      });
      const bounded = withCallbackDeadline(never, budget);
      const beforeDefault = await Promise.race([bounded, Promise.resolve('pending')]);
      expect(beforeDefault).toBe('pending');
      await jest.advanceTimersByTimeAsync(DEFAULT_CALLBACK_TIMEOUT_MS - 1);
      const stillPending = await Promise.race([bounded, Promise.resolve('pending')]);
      expect(stillPending).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      await expect(bounded).rejects.toThrow('callback timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a callback that outlives its budget', async (): Promise<void> => {
    const never = new Promise<string>(() => {
      // Never resolves: the deadline must win.
    });
    const bounded = withCallbackDeadline(never, 5);
    await expect(bounded).rejects.toThrow('callback timed out');
  });

  it('rejects when the run aborts before the callback settles', async (): Promise<void> => {
    const controller = new AbortController();
    const never = new Promise<string>(() => {
      // Never resolves: the run abort must win.
    });
    const pending = runWithBankContext('pepper', () => withCallbackDeadline(never, 5000), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('scrape aborted');
  });

  it('rejects immediately when the run is already aborted', async (): Promise<void> => {
    const controller = new AbortController();
    controller.abort();
    const work = Promise.resolve('stored');
    /**
     * Wait for the callback under the aborted run.
     * @returns The callback result.
     */
    const run = (): Promise<string> => withCallbackDeadline(work, 5000);
    const pending = runWithBankContext('pepper', run, { signal: controller.signal });
    await expect(pending).rejects.toThrow('scrape aborted');
  });

  it('observes a late rejection after the run abort wins', async (): Promise<void> => {
    const controller = new AbortController();
    /**
     * Placeholder until the promise executor wires its reject.
     * @returns True.
     */
    function ignoreReject(): boolean {
      return true;
    }
    let rejectWork: (error: Error) => unknown = ignoreReject;
    const work = new Promise<string>((_resolve, reject) => {
      rejectWork = reject;
    });
    /**
     * Wait for the callback under the aborted run.
     * @returns The callback result.
     */
    const run = (): Promise<string> => withCallbackDeadline(work, 5000);
    const pending = runWithBankContext('pepper', run, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('scrape aborted');
    rejectWork(new Error('late callback rejection'));
    await Promise.resolve();
  });
});
