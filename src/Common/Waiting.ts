import type { Falsy } from 'utility-types';

/** Error thrown when an async wait operation exceeds its timeout. */
export class TimeoutError extends Error {}

export const SECOND = 1000;

type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;

/**
 * Race a promise against a timeout, rejecting with TimeoutError if the timeout fires first.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race against the timeout.
 * @param description - A description for the timeout error message.
 * @returns The resolved promise value if it completes before the timeout.
 */
function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const timeout = new Promise((_, reject) => {
    const id = global.setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout as Promise<T>]);
}

/** Callbacks for the wait-tick polling loop. */
interface IWaitCallbacks<T> {
  /** Called when the async test resolves with a truthy value. */
  resolve: (resolvedValue: NonNullable<T>) => boolean;
  /** Called when the async test throws an error. */
  reject: () => boolean;
}

/**
 * Create a polling function that calls asyncTest at intervals until truthy.
 * @param asyncTest - The async predicate to poll.
 * @param interval - The polling interval in milliseconds.
 * @param cbs - The resolve/reject callbacks.
 * @returns A function that starts the polling loop and returns true.
 */
function makeWaitTick<T>(
  asyncTest: () => Promise<T>,
  interval: number,
  cbs: IWaitCallbacks<T>,
): () => boolean {
  /**
   * Execute one polling iteration and schedule the next if needed.
   * @returns True after scheduling or resolving.
   */
  function wait(): boolean {
    asyncTest()
      .then(value => {
        if (value) cbs.resolve(value as unknown as NonNullable<T>);
        else global.setTimeout(wait, interval);
      })
      .catch(() => {
        cbs.reject();
      });
    return true;
  }
  return wait;
}

/**
 * Build a promise that polls asyncTest until it returns a truthy value.
 * @param asyncTest - The async predicate to poll.
 * @param interval - The polling interval in milliseconds.
 * @returns A promise that resolves with the first truthy value.
 */
function buildWaitPromise<T>(
  asyncTest: () => Promise<T>,
  interval: number,
): Promise<NonNullable<T>> {
  return new Promise<NonNullable<T>>((resolve, reject) => {
    /**
     * Wrap resolve to match IWaitCallbacks signature.
     * @param resolvedValue - The resolved value from the async test.
     * @returns True after resolving.
     */
    const wrappedResolve = (resolvedValue: NonNullable<T>): boolean => {
      resolve(resolvedValue);
      return true;
    };
    /**
     * Wrap reject to match IWaitCallbacks signature.
     * @returns True after rejecting.
     */
    const wrappedReject = (): boolean => {
      reject(new TimeoutError('waitUntil polling rejected'));
      return true;
    };
    makeWaitTick(asyncTest, interval, {
      resolve: wrappedResolve,
      reject: wrappedReject,
    })();
  });
}

/** Options for the waitUntil polling function. */
export interface IWaitUntilOpts {
  timeout?: number;
  interval?: number;
}

/**
 * Safely stringify a value for diagnostic messages, truncating to 100 chars.
 * @param value - The value to stringify.
 * @returns A truncated string representation.
 */
function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.slice(0, 100) : 'undefined';
  } catch {
    return String(value).slice(0, 100);
  }
}

/**
 * Create a tracking test wrapper that records the last polled value.
 * @param asyncTest - The async predicate to wrap.
 * @param state - The state object to store the last seen value.
 * @param state.lastSeen - The last polled value (mutated by the tracking test).
 * @returns A wrapped async test function.
 */
function createTrackingTest<T>(
  asyncTest: () => Promise<T>,
  state: { lastSeen: unknown },
): () => Promise<T> {
  return async (): Promise<T> => {
    const polledValue = await asyncTest();
    state.lastSeen = polledValue;
    return polledValue;
  };
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout.
 * On timeout the error message includes the last polled value for diagnostics.
 * @param asyncTest - The async predicate to poll.
 * @param description - A description for the timeout error message.
 * @param opts - Optional timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: IWaitUntilOpts = {},
): WaitUntilReturn<T> {
  const { timeout = 10000, interval = 100 } = opts;
  const state = { lastSeen: undefined as unknown };
  const trackingTest = createTrackingTest(asyncTest, state);
  const promise = buildWaitPromise(trackingTest, interval);
  const withContext = timeoutPromise(timeout, promise, description).catch((caught: unknown) => {
    if (!(caught instanceof TimeoutError)) throw caught;
    const lastStr = safeStringify(state.lastSeen);
    throw new TimeoutError(`${caught.message} — last: ${lastStr}`);
  });
  return withContext as WaitUntilReturn<T>;
}

/** Sentinel indicating the race timed out before the promise resolved. */
export const RACE_TIMED_OUT = Symbol('RACE_TIMED_OUT');

/** Result of a timed race — the value if resolved, or the timeout sentinel. */
type RaceTimeoutResult<T> = Promise<T | typeof RACE_TIMED_OUT>;

/**
 * Race a promise against a timeout, returning a sentinel on timeout.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race.
 * @returns The resolved value, or RACE_TIMED_OUT if timed out.
 */
export function raceTimeout<T>(ms: number, promise: Promise<T>): RaceTimeoutResult<T> {
  return timeoutPromise(ms, promise, 'timeout').catch((err: unknown) => {
    if (!(err instanceof TimeoutError)) throw err;
    return RACE_TIMED_OUT;
  });
}

/**
 * Execute async actions sequentially, collecting all results.
 * @param actions - The array of async action factories.
 * @returns An array of all action results in order.
 */
export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  const initialValue = Promise.resolve<T[]>(new Array<T>());
  return actions.reduce(
    (memo, action) => memo.then(async accumulated => [...accumulated, await action()]),
    initialValue,
  );
}

/**
 * Pause execution for a given number of milliseconds.
 * @param ms - The duration to sleep in milliseconds.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<boolean> {
  return new Promise(resolve => {
    global.setTimeout(() => {
      resolve(true);
    }, ms);
  });
}

/**
 * Random delay that mimics human interaction timing.
 * Default range: 300-1200ms (realistic for clicks and navigation).
 * @param minMs - The minimum delay in milliseconds.
 * @param maxMs - The maximum delay in milliseconds.
 * @returns A promise that resolves after a random delay.
 */
export function humanDelay(minMs = 300, maxMs = 1200): Promise<boolean> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(resolve => {
    global.setTimeout(() => {
      resolve(true);
    }, delay);
  });
}
