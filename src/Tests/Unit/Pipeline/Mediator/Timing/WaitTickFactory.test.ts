/**
 * Unit tests for WaitTickFactory — builds polling promises for waitUntil.
 */

import { buildWaitPromise } from '../../../../../Scrapers/Pipeline/Mediator/Timing/WaitTickFactory.js';

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
    const value = await buildWaitPromise(asyncTest, 1);
    expect(value).toBe(42);
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
    const isOk = await buildWaitPromise(asyncTest, 1);
    expect(isOk).toBe(true);
  });

  it('rejects when asyncTest throws', async () => {
    /**
     * Always rejects to trigger reject callback.
     * @returns Rejected promise.
     */
    const asyncTest = (): Promise<boolean> => Promise.reject(new Error('fail'));
    const buildWaitPromiseResult1 = buildWaitPromise(asyncTest, 1);
    await expect(buildWaitPromiseResult1).rejects.toThrow();
  });

  it('accepts string truthy values', async () => {
    /**
     * Return non-empty string.
     * @returns The string 'hit'.
     */
    const asyncTest = (): Promise<string> => Promise.resolve('hit');
    const value = await buildWaitPromise(asyncTest, 1);
    expect(value).toBe('hit');
  });
});
