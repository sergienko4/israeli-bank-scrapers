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
 * Mutable cancellation state shared by every tick of one poll loop.
 *
 * <p>Without it the loop is unstoppable: {@link scheduleNext} dropped the
 * `setTimeout` handle, so once the caller lost its race against a timeout the
 * recursion kept re-arming forever — still invoking `asyncTest` and still
 * pinning whatever Playwright handle the closure had captured.
 */
interface IPollState {
  /** Set by {@link cancelPoll}; every later tick short-circuits. */
  cancelled: boolean;
  /** Handle of the pending next-tick timer, when one is armed. */
  timer: ReturnType<typeof globalThis.setTimeout> | undefined;
}

/** A running poll loop plus the handle needed to stop it. */
interface ICancellablePoll<T> {
  /** Resolves with the first truthy poll value. */
  readonly promise: Promise<NonNullable<T>>;
  /** Stops further ticks and clears any armed timer. Idempotent. */
  readonly cancel: () => boolean;
}

/**
 * Schedule the next polling iteration after a delay, retaining the timer
 * handle so {@link cancelPoll} can clear it.
 * @param wait - The polling function to call.
 * @param interval - Delay in ms.
 * @param state - Shared cancellation state for this loop.
 * @returns True when a tick was armed, false when the loop is cancelled.
 */
function scheduleNext(wait: () => boolean, interval: number, state: IPollState): boolean {
  if (state.cancelled) return false;
  state.timer = globalThis.setTimeout(wait, interval);
  return true;
}

/**
 * Stop a poll loop: block future ticks and clear any armed timer.
 * @param state - Shared cancellation state for this loop.
 * @returns True when an armed timer was cleared, false when none was pending.
 */
function cancelPoll(state: IPollState): boolean {
  const hasArmedTimer = state.timer !== undefined;
  state.cancelled = true;
  if (state.timer !== undefined) globalThis.clearTimeout(state.timer);
  state.timer = undefined;
  return hasArmedTimer;
}

/** Bundled args for creating a wait-tick. */
interface ITickArgs<T> {
  readonly asyncTest: () => Promise<T>;
  readonly interval: number;
  readonly cbs: IWaitCallbacks<T>;
  readonly state: IPollState;
}

/** Self-reference holder for recursive scheduling. */
interface ISelfRef {
  /** The poll function reference. */
  fn: () => boolean;
}

/**
 * Dispatch the async predicate and route its outcome to the wait callbacks.
 * @param args - Bundled tick arguments.
 * @param next - Arms the following tick when the predicate stays falsy.
 * @returns Always true — the dispatch itself never fails synchronously.
 */
function dispatchPoll<T>(args: ITickArgs<T>, next: () => boolean): boolean {
  args
    .asyncTest()
    .then((v): boolean => handlePollResult(v, args.cbs, next))
    .catch((): boolean => args.cbs.reject());
  return true;
}

/**
 * Execute one poll cycle: run async test, handle result or reject.
 *
 * <p>Forgets the timer handle before dispatching: that timer has already
 * fired, so leaving it recorded would make {@link cancelPoll} report an
 * armed tick and clear a dead handle.
 * @param args - Bundled tick arguments.
 * @param self - Self-reference holder for recursive scheduling.
 * @returns True after dispatching, false when the loop is already cancelled.
 */
function runOnePoll<T>(args: ITickArgs<T>, self: ISelfRef): boolean {
  if (args.state.cancelled) return false;
  args.state.timer = undefined;
  /**
   * Schedule the next tick iteration.
   * @returns True after scheduling next tick.
   */
  const next = (): boolean => scheduleNext(self.fn, args.interval, args.state);
  return dispatchPoll(args, next);
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
  readonly state: IPollState;
  readonly resolve: (value: NonNullable<T>) => boolean;
  readonly reject: (reason: Error) => boolean;
}

/**
 * Build callbacks + first tick for the poll loop. Hoisted so
 * {@link startPollPromise} stays a single delegation line.
 * @param args - Bundled executor args (asyncTest + interval + state + resolve + reject).
 * @returns Always true (sentinel for the createPromise executor).
 */
function runWaitTickExecutor<T>(args: IWaitExecutorArgs<T>): boolean {
  const { asyncTest, interval, state } = args;
  const cbs = buildWaitCallbacks<T>(args.resolve, args.reject);
  const tick = createTickFn({ asyncTest, interval, cbs, state });
  tick();
  return true;
}

/** Bundled args for {@link startPollPromise} — keeps params ≤ 3. */
interface IStartPollArgs<T> {
  readonly asyncTest: () => Promise<T>;
  readonly interval: number;
  readonly state: IPollState;
}

/**
 * Start the poll loop and expose it as a promise.
 * @param args - Bundled asyncTest + interval + cancellation state.
 * @returns A promise resolving with the first truthy poll value.
 */
function startPollPromise<T>(args: IStartPollArgs<T>): Promise<NonNullable<T>> {
  const { asyncTest, interval, state } = args;
  return createPromise<NonNullable<T>>((resolve, reject): boolean =>
    runWaitTickExecutor<T>({ asyncTest, interval, state, resolve, reject }),
  );
}

/**
 * Build a cancellable poll that resolves with the first truthy `asyncTest` value.
 *
 * <p>Callers MUST invoke {@link ICancellablePoll.cancel} once they stop caring
 * about the result — typically in a `finally` around the race that consumes it.
 * The poll has no internal deadline, so an uncancelled loop outlives its caller
 * and keeps the captured Playwright handles reachable forever.
 * @param asyncTest - The async predicate to poll.
 * @param interval - The polling interval in milliseconds.
 * @returns The poll promise paired with its canceller.
 */
function buildWaitPromise<T>(asyncTest: () => Promise<T>, interval: number): ICancellablePoll<T> {
  const state: IPollState = { cancelled: false, timer: undefined };
  const promise = startPollPromise<T>({ asyncTest, interval, state });
  /**
   * Stop this poll loop.
   * @returns True when an armed timer was cleared.
   */
  const cancel = (): boolean => cancelPoll(state);
  return { promise, cancel };
}

export default buildWaitPromise;
export { buildWaitPromise };
export type { ICancellablePoll };
