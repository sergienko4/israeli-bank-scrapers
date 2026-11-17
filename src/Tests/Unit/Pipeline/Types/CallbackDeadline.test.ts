/**
 * Caller callbacks are bounded: a settled callback resolves, and one that
 * outlives its budget rejects with a fixed error instead of holding the run.
 */

import { runWithBankContext } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import withCallbackDeadline from '../../../../Scrapers/Pipeline/Types/CallbackDeadline.js';

describe('withCallbackDeadline', () => {
  it('returns the callback result when it settles in time', async (): Promise<void> => {
    const work = Promise.resolve('stored');
    const result = await withCallbackDeadline(work, 50);
    expect(result).toBe('stored');
  });

  it.each([Number.NaN, -1])('falls back to the default for an unusable budget %s', async budget => {
    const work = Promise.resolve('stored');
    const result = await withCallbackDeadline(work, budget);
    expect(result).toBe('stored');
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
});
