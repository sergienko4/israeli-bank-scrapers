import { TimeoutError, waitUntil, raceTimeout, runSerial, sleep, SECOND } from './waiting';

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
      5000,
      10,
    );
    expect(result).toBe('done');
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('rejects with TimeoutError when condition is never met', async () => {
    await expect(waitUntil(() => Promise.resolve(false), 'never true', 100, 10)).rejects.toThrow(TimeoutError);
  });

  // waitUntil's catch handler calls reject() with no value (undefined)
  it('rejects when async test throws', async () => {
    await expect(
      waitUntil(() => Promise.reject(new Error('test error')), 'failing test', 5000, 10),
    ).rejects.toBeUndefined();
  });
});

describe('raceTimeout', () => {
  it('returns promise result when it resolves before timeout', async () => {
    const result = await raceTimeout(5000, Promise.resolve('fast'));
    expect(result).toBe('fast');
  });

  it('returns undefined when promise times out', async () => {
    const result = await raceTimeout(
      50,
      sleep(200).then(() => 'slow'),
    );
    expect(result).toBeUndefined();
  });

  it('throws non-timeout errors from the promise', async () => {
    await expect(raceTimeout(5000, Promise.reject(new Error('real error')))).rejects.toThrow('real error');
  });
});

describe('runSerial', () => {
  it('executes actions sequentially and returns results', async () => {
    const order: number[] = [];
    const actions = [1, 2, 3].map(n => () => {
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
    const actions = [() => Promise.resolve(1), () => Promise.reject(new Error('fail'))];
    await expect(runSerial(actions)).rejects.toThrow('fail');
  });
});
