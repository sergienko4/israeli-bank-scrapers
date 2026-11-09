import { SECOND } from '../../Scrapers/Pipeline/Mediator/Timing/SharedTimingConstants.js';
import {
  humanDelay,
  RACE_TIMED_OUT,
  raceTimeout,
  runSerial,
  sleep as waitForMs,
  TimeoutError,
} from '../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';

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

describe('sleep (async delay)', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await waitForMs(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});

describe('raceTimeout', () => {
  it('returns promise result when it resolves before timeout', async () => {
    const fastPromise = Promise.resolve('fast');
    const result: string | typeof RACE_TIMED_OUT = await raceTimeout(5000, fastPromise);
    expect(result).toBe('fast');
  });

  it('returns RACE_TIMED_OUT sentinel when promise times out', async () => {
    const slowPromise = waitForMs(200).then((): string => 'slow');
    const result: string | typeof RACE_TIMED_OUT = await raceTimeout(50, slowPromise);
    expect(result).toBe(RACE_TIMED_OUT);
  });

  it('throws non-timeout errors from the promise', async () => {
    const rejectedPromise = Promise.reject(new Error('real error'));
    const failingPromise = raceTimeout(5000, rejectedPromise);
    await expect(failingPromise).rejects.toThrow('real error');
  });
});

describe('Sequential Action Executor (runSerial)', () => {
  it('executes actions sequentially and returns results', async () => {
    const order: number[] = [];
    const actions = [1, 2, 3].map((n): (() => Promise<number>) => () => {
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

describe('humanDelay', () => {
  it('accepts equal bounds for fixed OTP polling delays', async () => {
    const result = await humanDelay(2, 2);
    expect(result).toMatchObject({ success: true });
  });

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
