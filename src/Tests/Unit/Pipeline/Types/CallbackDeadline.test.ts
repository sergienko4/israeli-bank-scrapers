/**
 * Caller callbacks are bounded: a settled callback resolves, and one that
 * outlives its budget rejects with a fixed error instead of holding the run.
 */

import withCallbackDeadline from '../../../../Scrapers/Pipeline/Types/CallbackDeadline.js';

describe('withCallbackDeadline', () => {
  it('returns the callback result when it settles in time', async (): Promise<void> => {
    const work = Promise.resolve('stored');
    const result = await withCallbackDeadline(work, 50);
    expect(result).toBe('stored');
  });

  it('rejects a callback that outlives its budget', async (): Promise<void> => {
    const never = new Promise<string>(() => {
      // Never resolves: the deadline must win.
    });
    const bounded = withCallbackDeadline(never, 5);
    await expect(bounded).rejects.toThrow('callback timed out');
  });
});
