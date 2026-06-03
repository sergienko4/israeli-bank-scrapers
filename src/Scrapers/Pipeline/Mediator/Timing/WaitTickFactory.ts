/**
 * Wait-tick factory — creates polling functions for waitUntil.
 * Extracted from Waiting.ts to respect max-lines.
 */

import { createPromise, createTimeoutError } from './TimingActions.js';

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
function handlePollResult<T>(value: T, cbs: IWaitCallbacks<T>, nextFn: () => boolean): boolean {
  if (value) return cbs.resolve(value);
  return nextFn();
}

/**
 * Schedule the next polling iteration after a delay.
 * @param wait - The polling function to call.
 * @param interval - Delay in ms.
 * @returns True after scheduling.
 */
function scheduleNext(wait: () => boolean, interval: number): boolean {
  globalThis.setTimeout(wait, interval);
  return true;
}

/** Bundled args for creating a wait-tick. */
interface ITickArgs<T> {
  readonly asyncTest: () => Promise<T>;
  readonly interval: number;
  readonly cbs: IWaitCallbacks<T>;
}

/** Self-reference holder for recursive scheduling. */
interface ISelfRef {
  /** The poll function reference. */
  fn: () => boolean;
}

/**
 * Execute one poll cycle: run async test, handle result or reject.
 * @param args - Bundled tick arguments.
 * @param self - Self-reference holder for recursive scheduling.
 * @returns True after dispatching.
 */
function runOnePoll<T>(args: ITickArgs<T>, self: ISelfRef): boolean {
  /**
   * Schedule the next tick iteration.
   * @returns True after scheduling next tick.
   */
  const next = (): boolean => scheduleNext(self.fn, args.interval);
  args
    .asyncTest()
    .then((v): boolean => handlePollResult(v, args.cbs, next))
    .catch((): boolean => args.cbs.reject());
  return true;
}

/**
 * Create a single poll iteration function from args.
 * @param args - Bundled tick arguments.
 * @returns A function that runs one poll cycle.
 */
function createTickFn<T>(args: ITickArgs<T>): () => boolean {
  /**
   * No-op placeholder.
   * @returns True.
   */
  const noop = (): boolean => true;
  const holder: ISelfRef = { fn: noop };
  const poll = runOnePoll;
  /**
   * Actual poll function bound to args.
   * @returns True after poll dispatched.
   */
  holder.fn = (): boolean => poll(args, holder);
  return holder.fn;
}

/**
 * Wrap a resolve callback with typed return.
 * @param resolve - Raw resolve callback.
 * @returns Wrapped resolve returning boolean.
 */
function wrapResolve<T>(
  resolve: (value: NonNullable<T>) => boolean,
): (v: NonNullable<T>) => boolean {
  return (v: NonNullable<T>): boolean => resolve(v);
}

/**
 * Wrap a reject callback with a timeout error.
 * @param reject - Raw reject callback.
 * @returns Wrapped reject returning boolean.
 */
function wrapReject(reject: (reason: Error) => boolean): () => boolean {
  const pollingError = createTimeoutError('waitUntil polling rejected');
  return (): boolean => reject(pollingError);
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

/** Bundled args for {@link runWaitTickExecutor} — keeps params ≤ 3. */
interface IWaitExecutorArgs<T> {
  readonly asyncTest: () => Promise<T>;
  readonly interval: number;
  readonly resolve: (value: NonNullable<T>) => boolean;
  readonly reject: (reason: Error) => boolean;
}

/**
 * Build callbacks + first tick for the poll loop. Hoisted so
 * {@link buildWaitPromise} stays a single delegation line.
 * @param args - Bundled executor args (asyncTest + interval + resolve + reject).
 * @returns Always true (sentinel for the createPromise executor).
 */
function runWaitTickExecutor<T>(args: IWaitExecutorArgs<T>): boolean {
  const cbs = buildWaitCallbacks<T>(args.resolve, args.reject);
  const tick = createTickFn({ asyncTest: args.asyncTest, interval: args.interval, cbs });
  tick();
  return true;
}

/**
 * Build a promise that polls asyncTest until truthy.
 * @param asyncTest - The async predicate to poll.
 * @param interval - The polling interval in milliseconds.
 * @returns A promise that resolves with the first truthy value.
 */
function buildWaitPromise<T>(
  asyncTest: () => Promise<T>,
  interval: number,
): Promise<NonNullable<T>> {
  return createPromise<NonNullable<T>>((resolve, reject): boolean =>
    runWaitTickExecutor<T>({ asyncTest, interval, resolve, reject }),
  );
}

export default buildWaitPromise;
export { buildWaitPromise };
