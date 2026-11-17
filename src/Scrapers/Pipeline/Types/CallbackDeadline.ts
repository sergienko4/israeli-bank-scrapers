/**
 * Bound caller-owned callbacks: a callback that never settles must not hold a
 * scrape open forever. The owned timer keeps the process alive until the race
 * settles and is cleared afterwards; a run abort releases it immediately.
 */

import ScraperError from '../../Base/ScraperError.js';
import { currentAbortSignal } from './RunScope.js';

/** Default wait for a caller callback, in milliseconds. */
const DEFAULT_CALLBACK_TIMEOUT_MS = 30_000;

/** Largest delay the platform timer accepts, in milliseconds. */
const MAX_TIMER_MS = 2_147_483_647;
const RUN_ABORT_MESSAGE = 'scrape aborted';

/** Rejection raised when a caller callback exceeds its budget. */
class CallbackTimeoutError extends ScraperError {}

/** A pending rejection plus its cleanup hook. */
interface ITimeoutWait {
  readonly promise: Promise<never>;
  readonly dispose: () => boolean;
}

/** A pending run-abort rejection plus its listener cleanup. */
interface IAbortWait {
  readonly promise: Promise<never>;
  readonly dispose: () => boolean;
}

/**
 * Reject with the fixed callback deadline error.
 * @param reject - The promise's reject function.
 * @returns The timer callback.
 */
function timeoutRejection(reject: (error: unknown) => unknown): () => boolean {
  return (): boolean => {
    reject(new CallbackTimeoutError('callback timed out'));
    return true;
  };
}

/**
 * Reject with the fixed run-abort error.
 * @param reject - The promise's reject function.
 * @returns The abort listener.
 */
function abortRejection(reject: (error: unknown) => unknown): () => boolean {
  return (): boolean => {
    reject(new ScraperError(RUN_ABORT_MESSAGE));
    return true;
  };
}

/**
 * Resolve a usable callback budget.
 * @param timeoutMs - Configured budget, when supplied.
 * @returns A positive integer within the platform timer range.
 */
function callbackBudget(timeoutMs?: number): number {
  if (timeoutMs === undefined) return DEFAULT_CALLBACK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_CALLBACK_TIMEOUT_MS;
  const wholeMs = Math.floor(timeoutMs);
  return Math.min(wholeMs, MAX_TIMER_MS);
}

/**
 * Clear one timer if it is live.
 * @param timer - Timer handle, or false when none was created.
 * @returns True when a timer was cleared.
 */
function clearTimer(timer: ReturnType<typeof globalThis.setTimeout> | false): boolean {
  if (timer === false) return false;
  globalThis.clearTimeout(timer);
  return true;
}

/**
 * Build a ref'd timer that rejects after the budget.
 * @param ms - Delay in milliseconds.
 * @returns The rejection promise and its timer cleanup.
 */
function ownedTimeout(ms: number): ITimeoutWait {
  let timer: ReturnType<typeof globalThis.setTimeout> | false = false;
  const promise = new Promise<never>((_resolve, reject) => {
    const fire = timeoutRejection(reject);
    timer = globalThis.setTimeout(fire, ms);
  });
  return { promise, dispose: clearTimer.bind(null, timer) };
}

/**
 * Build the abort rejection for an active run signal.
 * @param signal - The run signal.
 * @returns The pending rejection and its listener cleanup.
 */
function abortWait(signal: AbortSignal): IAbortWait {
  let removeListener = disposeNothing;
  const promise = new Promise<never>((_resolve, reject) => {
    const listener = abortRejection(reject);
    signal.addEventListener('abort', listener, { once: true });
    removeListener = makeDispose(signal, listener);
  });
  return { promise, dispose: removeListener };
}

/**
 * A no-op cleanup used before a listener is installed.
 * @returns True.
 */
function disposeNothing(): boolean {
  return true;
}

/**
 * Build the cleanup that removes one abort listener.
 * @param signal - The run signal.
 * @param listener - The installed listener.
 * @returns The cleanup.
 */
function makeDispose(signal: AbortSignal, listener: () => boolean): () => boolean {
  return (): boolean => {
    signal.removeEventListener('abort', listener);
    return true;
  };
}

/**
 * Build the rejection that fires when the run aborts.
 * @returns The pending rejection, or false outside a cancellation run.
 */
function runAbortWait(): IAbortWait | false {
  const signal = currentAbortSignal();
  if (signal === false) return false;
  if (signal.aborted) {
    const rejected = Promise.reject(new ScraperError(RUN_ABORT_MESSAGE));
    return { promise: rejected, dispose: disposeNothing };
  }
  return abortWait(signal);
}

/**
 * Release the timer and abort listener after a callback race settles.
 * @param timeout - The owned timer wait.
 * @param abort - The run-abort wait, when one exists.
 * @returns True once both are released.
 */
function disposeWaits(timeout: ITimeoutWait, abort: IAbortWait | false): boolean {
  timeout.dispose();
  if (abort !== false) abort.dispose();
  return true;
}

/**
 * Refuse an already-aborted run while observing the callback's rejection.
 * @param signal - The run signal, or false when none exists.
 * @param work - The callback promise.
 * @returns Nothing when the run is live.
 */
function throwIfAborted(signal: AbortSignal | false, work: Promise<unknown>): boolean {
  if (signal === false || !signal.aborted) return false;
  work.catch(() => undefined);
  throw new ScraperError(RUN_ABORT_MESSAGE);
}

/**
 * Race a callback against its budget and the run signal.
 * @param work - The callback's promise.
 * @param timeoutMs - Maximum wait; the default applies when absent.
 * @returns The callback's result.
 * @throws ScraperError when the deadline or the run signal wins.
 */
async function withCallbackDeadline<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
  const signal = currentAbortSignal();
  throwIfAborted(signal, work);
  const ms = callbackBudget(timeoutMs);
  const timeout = ownedTimeout(ms);
  const abort = runAbortWait();
  const races = abort === false ? [work, timeout.promise] : [work, timeout.promise, abort.promise];
  const cleanup = disposeWaits.bind(null, timeout, abort);
  return Promise.race(races).finally(cleanup);
}

export { CallbackTimeoutError };
export default withCallbackDeadline;
