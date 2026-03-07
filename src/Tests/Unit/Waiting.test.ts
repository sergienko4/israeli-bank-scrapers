import type { Page } from 'playwright';

import {
  humanDelay,
  raceTimeout,
  runSerial,
  SECOND,
  sleep,
  TimeoutError,
  waitUntil,
  waitUntilWithReload,
} from '../../Common/Waiting';

describe('SECOND', () => {
  it('equals 1000', () => {
    expect(SECOND).toBe(1000);
  });
});

describe('TimeoutError', () => {
  it('is an instance of Error', () => {
    const err = new TimeoutError('timed out');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.message).toBe('timed out');
  });
});

describe('sleep', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});

describe('waitUntil', () => {
  it('resolves when async test returns truthy', async () => {
    let count = 0;
    const result = await waitUntil(
      () => {
        count += 1;
        return Promise.resolve(count >= 3 ? 'done' : null);
      },
      'test',
      { timeout: 5000, interval: 10 },
    );
    expect(result).toBe('done');
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('rejects with TimeoutError when condition is never met', async () => {
    const neverTruePromise = waitUntil(() => Promise.resolve(false), 'never true', {
      timeout: 100,
      interval: 10,
    });
    await expect(neverTruePromise).rejects.toThrow(TimeoutError);
  });

  it('rejects when async test throws', async () => {
    const failingPromise = waitUntil(
      () => Promise.reject(new Error('test error')),
      'failing test',
      { timeout: 5000, interval: 10 },
    );
    await expect(failingPromise).rejects.toThrow();
  });
});

describe('raceTimeout', () => {
  it('returns promise result when it resolves before timeout', async () => {
    const fastPromise = Promise.resolve('fast');
    const result: unknown = await raceTimeout(5000, fastPromise);
    expect(result).toBe('fast');
  });

  it('returns done result when promise times out', async () => {
    const slowPromise = sleep(200).then(() => 'slow');
    const result: unknown = await raceTimeout(50, slowPromise);
    expect(result).toEqual({ done: true });
  });

  it('throws non-timeout errors from the promise', async () => {
    const rejectPromise = Promise.reject(new Error('real error'));
    const racePromise = raceTimeout(5000, rejectPromise);
    await expect(racePromise).rejects.toThrow('real error');
  });
});

describe('runSerial', () => {
  it('executes actions sequentially and returns results', async () => {
    const order: number[] = [];
    const actions = [1, 2, 3].map(n => (): Promise<number> => {
      order.push(n);
      return Promise.resolve(n * 10);
    });
    const result = await runSerial(actions);
    expect(result).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('returns empty array for no actions', async () => {
    const result = await runSerial([]);
    expect(result).toEqual([]);
  });

  it('propagates errors from actions', async () => {
    const actions = [
      (): Promise<number> => Promise.resolve(1),
      (): Promise<number> => Promise.reject(new Error('fail')),
    ];
    const serialPromise = runSerial(actions);
    await expect(serialPromise).rejects.toThrow('fail');
  });
});

describe('waitUntilWithReload', () => {
  it('returns found=true when condition met immediately', async () => {
    const page = { reload: jest.fn() } as unknown as Page;
    const result = await waitUntilWithReload(page, () => Promise.resolve('auth-token'), {
      description: 'test',
      pollTimeout: 5000,
      reloadAttempts: 2,
      interval: 10,
    });
    expect(result.found).toBe(true);
    if (result.found) expect(result.value).toBe('auth-token');
    expect(result.reloadsUsed).toBe(0);
  });

  it('reloads and returns found=false when condition never met', async () => {
    const mockReload = jest.fn().mockResolvedValue(undefined);
    const page = { reload: mockReload } as unknown as Page;
    const result = await waitUntilWithReload(page, () => Promise.resolve(null), {
      description: 'test',
      pollTimeout: 50,
      reloadAttempts: 1,
      interval: 10,
    });
    expect(result.found).toBe(false);
    expect(result.reloadsUsed).toBe(1);
    expect(mockReload).toHaveBeenCalledWith({ waitUntil: 'networkidle' });
  });
});

describe('humanDelay', () => {
  it('resolves after a delay within the specified range', async () => {
    const start = Date.now();
    await humanDelay(10, 50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(9);
    expect(elapsed).toBeLessThan(200);
  });

  it('uses default range when no arguments given', async () => {
    const start = Date.now();
    await humanDelay();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(250);
  });
});
