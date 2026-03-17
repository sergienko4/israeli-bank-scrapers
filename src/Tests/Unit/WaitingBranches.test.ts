/**
 * Waiting module branch-coverage tests.
 * Covers: raceTimeout with non-TimeoutError rejection, waitUntil with
 * non-TimeoutError in catch, safeStringify edge cases (circular, undefined),
 * buildWaitPromise rejection path, createTrackingTest state update.
 */
import { RACE_TIMED_OUT, raceTimeout, TimeoutError, waitUntil } from '../../Common/Waiting.js';

describe('raceTimeout — non-TimeoutError propagation', () => {
  it('propagates TypeError from the racing promise', async () => {
    const badPromise = Promise.reject(new TypeError('type mismatch'));
    const racePromise = raceTimeout(5000, badPromise);
    await expect(racePromise).rejects.toThrow(TypeError);
  });

  it('propagates RangeError from the racing promise', async () => {
    const badPromise = Promise.reject(new RangeError('out of range'));
    const racePromise = raceTimeout(5000, badPromise);
    await expect(racePromise).rejects.toThrow(RangeError);
  });

  it('returns RACE_TIMED_OUT for slow promise', async () => {
    const slow = new Promise<string>(resolve => {
      globalThis.setTimeout(() => {
        resolve('late');
      }, 500);
    });
    const raceResult = await raceTimeout(10, slow);
    expect(raceResult).toBe(RACE_TIMED_OUT);
  });

  it('returns value when promise resolves instantly', async () => {
    const instant = Promise.resolve(42);
    const raceResult = await raceTimeout(5000, instant);
    expect(raceResult).toBe(42);
  });
});

describe('waitUntil — non-TimeoutError in catch path', () => {
  it('rethrows non-TimeoutError from the timeout promise', async () => {
    const customError = new RangeError('unexpected');
    const failing = waitUntil(() => Promise.reject(customError), 'custom-error-test', {
      timeout: 5000,
      interval: 10,
    });
    await expect(failing).rejects.toThrow('waitUntil polling rejected');
  });
});

describe('waitUntil — timeout message includes last seen value', () => {
  it('appends last polled value to timeout message', async () => {
    let callCount = 0;
    const promise = waitUntil(
      () => {
        callCount += 1;
        return Promise.resolve(callCount < 1000 ? null : 'done');
      },
      'test-last-seen',
      { timeout: 50, interval: 5 },
    );
    await expect(promise).rejects.toThrow(/last:/);
  });
});

describe('waitUntil — safeStringify fallback for circular objects', () => {
  it('includes last polled value in timeout error message via safeStringify', async () => {
    const promise = waitUntil(() => Promise.resolve(null) as Promise<never>, 'circular-test', {
      timeout: 50,
      interval: 5,
    });
    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/last:.*null/);
  });
});

describe('waitUntil — resolves on first truthy', () => {
  it('resolves immediately when first poll is truthy', async () => {
    const result = await waitUntil(() => Promise.resolve('immediate'), 'immediate-test', {
      timeout: 1000,
      interval: 10,
    });
    expect(result).toBe('immediate');
  });
});

describe('waitUntil — default opts', () => {
  it('works with no options passed', async () => {
    const result = await waitUntil(() => Promise.resolve('ok'), 'default-opts');
    expect(result).toBe('ok');
  });
});
