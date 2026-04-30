/**
 * Wait-tick factory — creates polling functions for waitUntil.
 * Extracted from Waiting.ts to respect max-lines.
 */

import { createPromise, createTimeoutError } from './TimingActions.js';

/** Timeout/delay in milliseconds. */
type DelayMs = number;
/** Whether an async operation completed. */
type OpDone = boolean;

/** Callbacks for the wait-tick polling loop. */
interface IWaitCallbacks<T> {
  /** Called when the async test resolves with a truthy value. */
  resolve: (resolvedValue: NonNullable<T>) => boolean;
  /** Called when the async test throws an error. */
  reject: () => boolean;
}

/**
 * Handle a single poll result: resolve if truthy, schedule next tick.
 * @param value - The polled value.
 * @param cbs - Resolve/reject callbacks.
 * @param nextFn - Schedules the next polling iteration.
 * @returns True after handling.
 */
function handlePollResult<T>(value: T, cbs: IWaitCallbacks<T>, nextFn: () => boolean): OpDone {
  if (value) return cbs.resolve(value);
  return nextFn();
}

/**
 * Schedule the next polling iteration after a delay.
 * @param wait - The polling function to call.
 * @param interval - Delay in ms.
 * @returns True after scheduling.
 */
function scheduleNext(wait: () => OpDone, interval: DelayMs): OpDone {
  globalThis.setTimeout(wait, interval);
  return true;
}

/** Bundled args for creating a wait-tick. */
interface ITickArgs<T> {
  readonly asyncTest: () => Promise<T>;
  readonly interval: DelayMs;
  readonly cbs: IWaitCallbacks<T>;
}

/** Self-reference holder for recursive scheduling. */
interface ISelfRef {
  /** The poll function reference. */
  fn: () => OpDone;
}

/**
 * Execute one poll cycle: run async test, handle result or reject.
 * @param args - Bundled tick arguments.
 * @param self - Self-reference holder for recursive scheduling.
 * @returns True after dispatching.
 */
function runOnePoll<T>(args: ITickArgs<T>, self: ISelfRef): OpDone {
  /**
   * Schedule the next tick iteration.
   * @returns True after scheduling next tick.
   */
  const next = (): OpDone => scheduleNext(self.fn, args.interval);
  args
    .asyncTest()
    .then((v): OpDone => handlePollResult(v, args.cbs, next))
    .catch((): OpDone => args.cbs.reject());
  return true;
}

/**
 * Create a single poll iteration function from args.
 * @param args - Bundled tick arguments.
 * @returns A function that runs one poll cycle.
 */
function createTickFn<T>(args: ITickArgs<T>): () => OpDone {
  /**
   * No-op placeholder.
   * @returns True.
   */
  const noop = (): OpDone => true;
  const holder: ISelfRef = { fn: noop };
  const poll = runOnePoll;
  /**
   * Actual poll function bound to args.
   * @returns True after poll dispatched.
   */
  holder.fn = (): OpDone => poll(args, holder);
  return holder.fn;
}

/**
 * Wrap a resolve callback with typed return.
 * @param resolve - Raw resolve callback.
 * @returns Wrapped resolve returning OpDone.
 */
function wrapResolve<T>(
  resolve: (value: NonNullable<T>) => boolean,
): (v: NonNullable<T>) => OpDone {
  return (v: NonNullable<T>): OpDone => resolve(v);
}

/**
 * Wrap a reject callback with a timeout error.
 * @param reject - Raw reject callback.
 * @returns Wrapped reject returning OpDone.
 */
function wrapReject(reject: (reason: Error) => boolean): () => OpDone {
  const pollingError = createTimeoutError('waitUntil polling rejected');
  return (): OpDone => reject(pollingError);
}

/**
 * Build IWaitCallbacks from raw promise resolve/reject.
 * @param resolve - The promise resolve callback.
 * @param reject - The promise reject callback.
 * @returns Typed wait callbacks.
 */
function buildWaitCallbacks<T>(
  resolve: (value: NonNullable<T>) => boolean,
  reject: (reason: Error) => boolean,
): IWaitCallbacks<T> {
  return { resolve: wrapResolve<T>(resolve), reject: wrapReject(reject) };
}

/**
 * Build a promise that polls asyncTest until truthy.
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
    const tick = createTickFn({ asyncTest, interval, cbs });
    tick();
    return true;
  });
}

export default buildWaitPromise;
export { buildWaitPromise };
