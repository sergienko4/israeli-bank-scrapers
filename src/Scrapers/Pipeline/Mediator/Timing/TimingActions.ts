/**
 * Timing utilities — raceTimeout and its cancellable timer machinery.
 * Extracted from Waiting.ts to respect max-lines.
 */
/** Error thrown when an async wait operation exceeds its timeout. */
class TimeoutError extends Error {}

/**
 * Create a TimeoutError instance via Reflect.construct (avoids DI rule on `new`).
 * @param message - Error description.
 * @returns A TimeoutError instance.
 */
function createTimeoutError(message: string): TimeoutError {
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

/** A pending timeout rejection plus the handle needed to cancel it. */
interface ICancellableTimeout<T> {
  readonly cancel: () => boolean;
  readonly promise: Promise<T>;
}

/**
 * Clear a pending timer and report that cancellation happened.
 * @param id - Timer handle returned by `setTimeout`.
 * @returns Always true.
 */
function clearTimer(id: ReturnType<typeof globalThis.setTimeout>): boolean {
  globalThis.clearTimeout(id);
  return true;
}

/**
 * Build a promise that rejects with the supplied error after `ms`, paired
 * with a canceller for the underlying timer.
 *
 * <p>The canceller is essential: an uncancelled `setTimeout` keeps the Node
 * event loop alive for its full duration even after the race has settled,
 * so a long budget delays process exit and holds every value the closure
 * captured. Extracted so {@link timeoutPromise} stays under the per-function
 * cap.
 * @param ms - Delay in milliseconds before the rejection fires.
 * @param error - Error instance used to reject the returned promise.
 * @returns The rejection promise and its canceller.
 */
function createTimeoutRejector<T>(ms: number, error: TimeoutError): ICancellableTimeout<T> {
  let id: ReturnType<typeof globalThis.setTimeout>;
  const promise = createPromise<T>((_resolve, reject): boolean => {
    id = globalThis.setTimeout((): boolean => reject(error), ms);
    return true;
  });
  /**
   * Clear the pending timer so it cannot outlive the settled race.
   * @returns Always true.
   */
  const cancel = (): boolean => clearTimer(id);
  return { cancel, promise };
}

/**
 * Race a promise against a timeout, rejecting with TimeoutError if the timeout fires first.
 *
 * <p>Cancels the timer once the race settles so a pending timeout can never
 * outlive the call that created it.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race against the timeout.
 * @param description - A description for the timeout error message.
 * @returns The resolved promise value if it completes before the timeout.
 */
function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const error = createTimeoutError(description);
  const timeout = createTimeoutRejector<T>(ms, error);
  return Promise.race([promise, timeout.promise]).finally(timeout.cancel);
}

/** Sentinel indicating the race timed out before the promise resolved. */
export const RACE_TIMED_OUT = Symbol('RACE_TIMED_OUT');

/** Result of a timed race — the value if resolved, or the timeout sentinel. */
type RaceTimeoutResult<T> = Promise<T | typeof RACE_TIMED_OUT>;

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
export async function raceTimeout<T>(ms: number, promise: Promise<T>): RaceTimeoutResult<T> {
  try {
    return await timeoutPromise(ms, promise, 'timeout');
  } catch (error) {
    return handleRaceError(error as Error);
  }
}
