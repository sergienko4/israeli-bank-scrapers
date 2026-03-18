/**
 * Waiting module branch-coverage tests.
 * Covers: raceTimeout (non-TimeoutError propagation via it.each,
 * slow/instant promise), waitUntil (non-TimeoutError catch,
 * timeout last-seen stringification for null/undefined/zero/empty-string/
 * circular-object, first-truthy resolution, default opts).
 */
import { RACE_TIMED_OUT, raceTimeout, TimeoutError, waitUntil } from '../../Common/Waiting.js';

/** Error constructor accepting a message string. */
type ErrorCtorWithMsg = new (msg: string) => Error;

describe('raceTimeout — non-TimeoutError propagation', () => {
  const rejectionCases: readonly (readonly [string, ErrorCtorWithMsg, string])[] = [
    ['TypeError', TypeError, 'type mismatch'],
    ['RangeError', RangeError, 'out of range'],
    ['SyntaxError', SyntaxError, 'bad syntax'],
  ];

  it.each(rejectionCases)(
    'propagates %s from the racing promise',
    async (...args: readonly [string, ErrorCtorWithMsg, string]) => {
      const [, errorClass, msg] = args;
      const errorInstance = new errorClass(msg);
      const badPromise = Promise.reject(errorInstance);
      const raceResult = raceTimeout(5000, badPromise);
      await expect(raceResult).rejects.toThrow(errorClass);
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
  /**
   * Poll returning undefined for timeout test.
   * @returns resolved undefined as never.
   */
  const pollUndefined = (): Promise<never> => Promise.resolve(undefined) as Promise<never>;
  /**
   * Poll returning zero for timeout test.
   * @returns resolved zero as never.
   */
  const pollZero = (): Promise<never> => Promise.resolve(0) as Promise<never>;
  /**
   * Poll returning empty string for timeout test.
   * @returns resolved empty string as never.
   */
  const pollEmpty = (): Promise<never> => Promise.resolve('') as Promise<never>;

  /** Table-driven falsy-value cases for timeout message. */
  const lastSeenCases: readonly (readonly [string, () => Promise<never>, RegExp])[] = [
    ['undefined', pollUndefined, /last:.*undefined/],
    ['zero', pollZero, /last:.*0/],
    ['empty-string', pollEmpty, /last:.*""/],
  ];

  it.each(lastSeenCases)(
    'appends stringified %s to timeout message',
    async (...args: readonly [string, () => Promise<never>, RegExp]) => {
      const [label, poller, pattern] = args;
      const promise = waitUntil(poller, `${label}-test`, {
        timeout: 50,
        interval: 5,
      });
      await expect(promise).rejects.toThrow(TimeoutError);
      await expect(promise).rejects.toThrow(pattern);
    },
  );

  it('falls back to String() when JSON.stringify throws', async () => {
    const promise = waitUntil(
      () => {
        const bigZero = BigInt(0);
        return Promise.resolve(bigZero) as Promise<never>;
      },
      'bigint-test',
      { timeout: 50, interval: 5 },
    );
    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/last:.*0/);
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
