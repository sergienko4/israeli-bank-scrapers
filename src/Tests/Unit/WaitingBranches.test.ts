/**
 * Waiting module branch-coverage tests.
 * Covers: raceTimeout (non-TimeoutError propagation, slow/instant promise),
 * waitUntil (non-TimeoutError catch, timeout last-seen stringification for
 * null/undefined/zero/empty-string, first-truthy resolution, default opts).
 */
import { RACE_TIMED_OUT, raceTimeout, TimeoutError, waitUntil } from '../../Common/Waiting.js';

describe('raceTimeout — non-TimeoutError propagation', () => {
  const rejectionCases = [
    ['TypeError', TypeError, 'type mismatch'],
    ['RangeError', RangeError, 'out of range'],
  ] as const;

  it.each(rejectionCases)(
    'propagates %s from the racing promise',
    async (_label, errorClass, msg) => {
      const badPromise = Promise.reject(new errorClass(msg));
      const racePromise = raceTimeout(5000, badPromise);
      await expect(racePromise).rejects.toThrow(errorClass);
    },
  );

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
    const promise = waitUntil(() => Promise.resolve(null), 'test-last-seen', {
      timeout: 50,
      interval: 5,
    });
    await expect(promise).rejects.toThrow(/last:/);
  });
});

describe('waitUntil — timeout error includes stringified last-seen value', () => {
  it('appends stringified undefined to timeout message', async () => {
    const promise = waitUntil(() => Promise.resolve(undefined) as Promise<never>, 'undef-test', {
      timeout: 50,
      interval: 5,
    });
    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/last:.*undefined/);
  });

  it('appends stringified zero to timeout message', async () => {
    const promise = waitUntil(() => Promise.resolve(0) as Promise<never>, 'zero-test', {
      timeout: 50,
      interval: 5,
    });
    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/last:.*0/);
  });

  it('appends stringified empty-string to timeout message', async () => {
    const promise = waitUntil(() => Promise.resolve('') as Promise<never>, 'empty-test', {
      timeout: 50,
      interval: 5,
    });
    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/last:.*""/);
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
