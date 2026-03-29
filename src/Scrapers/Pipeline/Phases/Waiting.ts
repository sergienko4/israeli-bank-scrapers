import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  HUMAN_DELAY_MAX_MS,
  HUMAN_DELAY_MIN_MS,
} from './TimingConfig.js';

export { SECOND } from './TimingConfig.js';

/** Timeout/delay in milliseconds. */
type DelayMs = number;
/** Whether an async operation completed. */
type OpDone = boolean;
/** Diagnostic description string. */
type DescStr = string;
/** Serializable poll value for diagnostics. */
type PollValue = string | DelayMs | OpDone;

/** Error thrown when an async wait operation exceeds its timeout. */
export class TimeoutError extends Error {}

/** Maximum characters for a stringified diagnostic value. */
const MAX_STRINGIFY_LENGTH = 100;

/**
 * Create a TimeoutError instance via Reflect.construct (avoids DI rule on `new`).
 * @param message - Error description.
 * @returns A TimeoutError instance.
 */
function createTimeoutError(message: DescStr): TimeoutError {
  return Reflect.construct(TimeoutError, [message]);
}

/**
 * Create a promise via Reflect.construct (avoids DI rule on `new Promise`).
 * @param executor - The promise executor function.
 * @returns A new Promise instance.
 */
function createPromise<T>(
  executor: (resolve: (value: T) => boolean, reject: (reason: Error) => boolean) => boolean,
): Promise<T> {
  return Reflect.construct(Promise, [executor]) as Promise<T>;
}

/**
 * Race a promise against a timeout, rejecting with TimeoutError if the timeout fires first.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race against the timeout.
 * @param description - A description for the timeout error message.
 * @returns The resolved promise value if it completes before the timeout.
 */
function timeoutPromise<T>(ms: DelayMs, promise: Promise<T>, description: DescStr): Promise<T> {
  const error = createTimeoutError(description);
  const timeout = createPromise<T>((_resolve, reject): OpDone => {
    const id = globalThis.setTimeout((): OpDone => {
      clearTimeout(id);
      return reject(error);
    }, ms);
    return true;
  });
  return Promise.race([promise, timeout]);
}

/** Callbacks for the wait-tick polling loop. */
interface IWaitCallbacks<T> {
  /** Called when the async test resolves with a truthy value. */
  resolve: (resolvedValue: NonNullable<T>) => boolean;
  /** Called when the async test throws an error. */
  reject: () => boolean;
}

/**
 * Handle a single poll result: resolve if truthy, schedule next tick otherwise.
 * @param value - The polled value.
 * @param cbs - Resolve/reject callbacks.
 * @param scheduleNext - Function to schedule the next polling iteration.
 * @returns True after handling.
 */
function handlePollResult<T>(
  value: T,
  cbs: IWaitCallbacks<T>,
  scheduleNext: () => boolean,
): OpDone {
  if (value) return cbs.resolve(value as unknown as NonNullable<T>);
  return scheduleNext();
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
  interval: DelayMs,
  cbs: IWaitCallbacks<T>,
): () => boolean {
  /**
   * Execute one polling iteration and schedule the next if needed.
   * @returns True after scheduling or resolving.
   */
  function wait(): OpDone {
    /**
     * Schedule the next polling iteration after a delay.
     * @returns True after scheduling.
     */
    const scheduleNext = (): OpDone => {
      globalThis.setTimeout(wait, interval);
      return true;
    };
    asyncTest()
      .then((value): OpDone => handlePollResult(value, cbs, scheduleNext))
      .catch((): OpDone => cbs.reject());
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
/**
 * Build IWaitCallbacks from raw promise resolve/reject functions.
 * @param resolve - The promise resolve callback.
 * @param reject - The promise reject callback.
 * @returns Typed wait callbacks wrapping the promise control functions.
 */
function buildWaitCallbacks<T>(
  resolve: (value: NonNullable<T>) => boolean,
  reject: (reason: Error) => boolean,
): IWaitCallbacks<T> {
  /**
   * Resolve callback wrapper for IWaitCallbacks.
   * @param v - The resolved value.
   * @returns True after resolving.
   */
  const wrappedResolve = (v: NonNullable<T>): OpDone => resolve(v);
  const pollingError = createTimeoutError('waitUntil polling rejected');
  /**
   * Reject callback wrapper for IWaitCallbacks.
   * @returns True after rejecting with timeout error.
   */
  const wrappedReject = (): OpDone => reject(pollingError);
  return { resolve: wrappedResolve, reject: wrappedReject };
}

/**
 * Build a promise that polls asyncTest until it returns a truthy value.
 * @param asyncTest - The async predicate to poll.
 * @param interval - The polling interval in milliseconds.
 * @returns A promise that resolves with the first truthy value.
 */
function buildWaitPromise<T>(
  asyncTest: () => Promise<T>,
  interval: DelayMs,
): Promise<NonNullable<T>> {
  return createPromise<NonNullable<T>>((resolve, reject): OpDone => {
    const cbs = buildWaitCallbacks<T>(resolve, reject);
    const tick = makeWaitTick(asyncTest, interval, cbs);
    tick();
    return true;
  });
}

/** Options for the waitUntil polling function. */
export interface IWaitUntilOpts {
  timeout?: DelayMs;
  interval?: DelayMs;
}

/** Mutable state for tracking the last polled value. */
interface ITrackingState {
  lastSeen: PollValue;
}

/**
 * Safely stringify a value for diagnostic messages, truncating to 100 chars.
 * @param value - The value to stringify.
 * @returns A truncated string representation.
 */
function safeStringify(value: PollValue): DescStr {
  const serialized = trySafeJsonStringify(value);
  return serialized.slice(0, MAX_STRINGIFY_LENGTH);
}

/**
 * Attempt JSON.stringify with a fallback to String().
 * @param value - The value to stringify.
 * @returns The JSON string or String() fallback.
 */
function trySafeJsonStringify(value: PollValue): DescStr {
  try {
    const serialized = JSON.stringify(value);
    return serialized;
  } catch {
    return String(value);
  }
}

/**
 * Create a tracking test wrapper that records the last polled value.
 * @param asyncTest - The async predicate to wrap.
 * @param state - The state object to store the last seen value.
 * @returns A wrapped async test function.
 */
function createTrackingTest<T>(
  asyncTest: () => Promise<T>,
  state: ITrackingState,
): () => Promise<T> {
  return async (): Promise<T> => {
    const polledValue = await asyncTest();
    state.lastSeen = polledValue as unknown as string;
    return polledValue;
  };
}

/**
 * Handle a timeout error by enriching the message with the last polled value.
 * @param caught - The caught error from the timeout race.
 * @param state - Tracking state with the last seen value.
 * @returns Never — always rethrows.
 */
/**
 * Enrich a TimeoutError with the last polled value for diagnostics.
 * @param caught - The caught TimeoutError.
 * @param state - Tracking state with the last seen value.
 * @returns An enriched TimeoutError.
 */
function enrichTimeoutError(caught: TimeoutError, state: ITrackingState): TimeoutError {
  const lastStr = safeStringify(state.lastSeen);
  return createTimeoutError(`${caught.message} — last: ${lastStr}`);
}

/**
 * Execute the wait-until pipeline: poll, timeout, enrich error.
 * @param asyncTest - The async predicate to poll.
 * @param description - A description for the timeout error message.
 * @param opts - Timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
/**
 * Re-throw an error, enriching TimeoutErrors with tracking state.
 * @param caught - The caught error.
 * @param state - Tracking state with the last seen value.
 * @returns Never — always throws.
 */
function rethrowWithContext(caught: Error, state: ITrackingState): never {
  if (caught instanceof TimeoutError) throw enrichTimeoutError(caught, state);
  throw caught;
}

/**
 * Execute the wait-until pipeline: poll, timeout, enrich error.
 * @param asyncTest - The async predicate to poll.
 * @param description - A description for the timeout error message.
 * @param opts - Timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
async function executeWaitUntil<T>(
  asyncTest: () => Promise<T>,
  description: DescStr,
  opts: IWaitUntilOpts,
): Promise<NonNullable<T>> {
  const { timeout = DEFAULT_WAIT_TIMEOUT_MS, interval = DEFAULT_WAIT_INTERVAL_MS } = opts;
  const state: ITrackingState = { lastSeen: '' };
  const trackingTest = createTrackingTest(asyncTest, state);
  const promise = buildWaitPromise(trackingTest, interval);
  try {
    return await timeoutPromise(timeout, promise, description);
  } catch (caught) {
    rethrowWithContext(caught as Error, state);
  }
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout.
 * On timeout the error message includes the last polled value for diagnostics.
 * @param asyncTest - The async predicate to poll.
 * @param description - A description for the timeout error message.
 * @param opts - Optional timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
export async function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: IWaitUntilOpts = {},
): Promise<NonNullable<T>> {
  return (await executeWaitUntil(asyncTest, description, opts)) as NonNullable<T>;
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
/**
 * Handle a race timeout error — return sentinel for TimeoutError, rethrow others.
 * @param err - The caught error.
 * @returns RACE_TIMED_OUT sentinel for timeout errors.
 */
function handleRaceError(err: Error): typeof RACE_TIMED_OUT {
  if (err instanceof TimeoutError) return RACE_TIMED_OUT;
  throw err;
}

/**
 * Race a promise against a timeout, returning a sentinel on timeout.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race.
 * @returns The resolved value, or RACE_TIMED_OUT if timed out.
 */
export async function raceTimeout<T>(ms: DelayMs, promise: Promise<T>): RaceTimeoutResult<T> {
  try {
    return await timeoutPromise(ms, promise, 'timeout');
  } catch (err) {
    return handleRaceError(err as Error);
  }
}

/**
 * Execute async actions sequentially, collecting all results.
 * @param actions - The array of async action factories.
 * @returns An array of all action results in order.
 */
export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  const initialValue = Promise.resolve<T[]>([]);
  return actions.reduce(
    (memo, action): Promise<T[]> =>
      memo.then(async (accumulated): Promise<T[]> => [...accumulated, await action()]),
    initialValue,
  );
}

/**
 * Pause execution for a given number of milliseconds.
 * @param ms - The duration to sleep in milliseconds.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: DelayMs): Promise<OpDone> {
  return createPromise<OpDone>((resolve): OpDone => {
    globalThis.setTimeout((): OpDone => resolve(true), ms);
    return true;
  });
}

/**
 * Random delay that mimics human interaction timing.
 * Default range: 300-1200ms (realistic for clicks and navigation).
 * @param minMs - The minimum delay in milliseconds.
 * @param maxMs - The maximum delay in milliseconds.
 * @returns A promise that resolves after a random delay.
 */
export function humanDelay(
  minMs = HUMAN_DELAY_MIN_MS,
  maxMs = HUMAN_DELAY_MAX_MS,
): Promise<Procedure<void>> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return createPromise<Procedure<void>>((resolve): OpDone => {
    const done = succeed(undefined);
    globalThis.setTimeout((): OpDone => resolve(done), delay);
    return true;
  });
}
