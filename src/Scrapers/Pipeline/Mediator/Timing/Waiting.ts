/**
 * Wait-until polling — polls asyncTest until truthy, with timeout and diagnostics.
 * Tick/callback internals in WaitTickFactory.ts.
 * Timing utilities (sleep, humanDelay, raceTimeout, runSerial) in TimingActions.ts.
 */

import { createTimeoutError, TimeoutError, timeoutPromise } from './TimingActions.js';
import { DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS } from './TimingConfig.js';
import { buildWaitPromise } from './WaitTickFactory.js';

export {
  humanDelay,
  RACE_TIMED_OUT,
  raceTimeout,
  runSerial,
  sleep,
  TimeoutError,
} from './TimingActions.js';
export { SECOND } from './TimingConfig.js';

/** Timeout/delay in milliseconds. */
type DelayMs = number;
/** Diagnostic description string. */
type DescStr = string;
/** Serializable poll value for diagnostics. */
type PollValue = string | DelayMs | boolean;

/** Maximum characters for a stringified diagnostic value. */
const MAX_STRINGIFY_LENGTH = 100;

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
 * Attempt JSON.stringify with a fallback to String().
 * @param value - The value to stringify.
 * @returns The JSON string or String() fallback.
 */
function trySafeJsonStringify(value: PollValue): DescStr {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Safely stringify a value for diagnostics, truncated to 100 chars.
 * @param value - The value to stringify.
 * @returns A truncated string representation.
 */
function safeStringify(value: PollValue): DescStr {
  return trySafeJsonStringify(value).slice(0, MAX_STRINGIFY_LENGTH);
}

/**
 * Create a tracking test that records the last polled value.
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
 * Enrich a TimeoutError with the last polled value.
 * @param caught - The caught TimeoutError.
 * @param state - Tracking state with the last seen value.
 * @returns An enriched TimeoutError.
 */
function enrichTimeoutError(caught: TimeoutError, state: ITrackingState): TimeoutError {
  const last = safeStringify(state.lastSeen);
  return createTimeoutError(`${caught.message} — last: ${last}`);
}

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
 * Build a tracked polling promise with state.
 * @param asyncTest - The async predicate to poll.
 * @param opts - Timeout and interval configuration.
 * @returns The promise and tracking state.
 */
function buildTrackedPoll<T>(
  asyncTest: () => Promise<T>,
  opts: IWaitUntilOpts,
): { promise: Promise<NonNullable<T>>; state: ITrackingState } {
  const interval = opts.interval ?? DEFAULT_WAIT_INTERVAL_MS;
  const state: ITrackingState = { lastSeen: '' };
  const trackingTest = createTrackingTest(asyncTest, state);
  const promise = buildWaitPromise(trackingTest, interval);
  return { promise, state };
}

/**
 * Execute the wait-until pipeline: poll, timeout, enrich error.
 * @param asyncTest - The async predicate to poll.
 * @param description - Timeout error description.
 * @param opts - Timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
async function executeWaitUntil<T>(
  asyncTest: () => Promise<T>,
  description: DescStr,
  opts: IWaitUntilOpts,
): Promise<NonNullable<T>> {
  const timeout = opts.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
  const { promise, state } = buildTrackedPoll(asyncTest, opts);
  try {
    return await timeoutPromise(timeout, promise, description);
  } catch (caught) {
    rethrowWithContext(caught as Error, state);
  }
}

/**
 * Wait until a promise resolves with a truthy value or reject on timeout.
 * @param asyncTest - The async predicate to poll.
 * @param description - Timeout error description.
 * @param opts - Optional timeout and interval configuration.
 * @returns The first truthy value from asyncTest.
 */
export async function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: IWaitUntilOpts = {},
): Promise<NonNullable<T>> {
  const result = await executeWaitUntil(asyncTest, description, opts);
  return result;
}
