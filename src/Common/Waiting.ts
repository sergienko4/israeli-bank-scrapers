import type { Page } from 'playwright';
import type { Falsy } from 'utility-types';

import type { IReloadRetryResult } from '../Interfaces/Common/ReloadRetryResult';
import type { IDoneResult } from '../Interfaces/Common/StepResult';
import type { IWaitUntilOpts } from '../Interfaces/Common/WaitUntilOpts';

export type { IReloadRetryResult } from '../Interfaces/Common/ReloadRetryResult';
export type { IWaitUntilOpts } from '../Interfaces/Common/WaitUntilOpts';

/** Error thrown when a polling operation exceeds its configured timeout. */
export class TimeoutError extends Error {}

export const SECOND = 1000;

type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;

/**
 * Races the given promise against a timeout, rejecting with a TimeoutError after ms milliseconds.
 *
 * @param ms - the timeout duration in milliseconds
 * @param promise - the promise to race against the timeout
 * @param description - a human-readable label included in the TimeoutError message
 * @returns the result of the promise if it resolves before the timeout
 */
function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([
    promise,
    // casting to avoid type error- safe since this promise will always reject
    timeout as Promise<T>,
  ]);
}

/**
 * Builds a promise that resolves when asyncTest returns a truthy value, polling at the given interval.
 *
 * @param asyncTest - the async predicate to poll; resolves the promise when it returns truthy
 * @param interval - the polling interval in milliseconds
 * @returns a promise that resolves with the first non-null/undefined truthy value from asyncTest
 */
function buildWaitPromise<T>(
  asyncTest: () => Promise<T>,
  interval: number,
): Promise<NonNullable<T>> {
  return new Promise<NonNullable<T>>((resolve, reject) => {
    /**
     * Inner polling loop: evaluates asyncTest and schedules the next tick or resolves.
     *
     * @returns a done result indicating the polling tick was scheduled
     */
    function wait(): IDoneResult {
      asyncTest()
        .then(value => {
          if (value) resolve(value as unknown as NonNullable<T>);
          else setTimeout(wait, interval);
        })
        .catch(() => {
          reject(new Error('asyncTest threw during polling'));
        });
      return { done: true };
    }
    wait();
  });
}

/**
 * Safely converts a value to a JSON string for diagnostic logging, truncating at 100 characters.
 * Returns String(v) when JSON.stringify throws (e.g. for circular references).
 *
 * @param v - the value to stringify
 * @returns a truncated JSON or string representation of the value
 */
function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s.slice(0, 100) : 'undefined';
  } catch {
    return String(v).slice(0, 100);
  }
}

/**
 * Polls asyncTest at the given interval until it returns a truthy value or the timeout expires.
 * On timeout, the error message includes the last polled value for diagnostics.
 *
 * @param asyncTest - the async predicate to poll; the wait ends when it returns truthy
 * @param description - a human-readable label used in the TimeoutError message
 * @param opts - optional polling configuration including timeout (ms) and interval (ms)
 * @returns a promise that resolves with the first truthy result from asyncTest
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: IWaitUntilOpts = {},
): WaitUntilReturn<T> {
  const { timeout = 10000, interval = 100 } = opts;
  let lastSeenValue: unknown;
  /**
   * Wraps asyncTest to capture each polled value for timeout diagnostics.
   *
   * @returns the result of the underlying asyncTest call
   */
  const trackingTest = async (): Promise<T> => {
    const v = await asyncTest();
    lastSeenValue = v;
    return v;
  };
  const promise = buildWaitPromise(trackingTest, interval);
  const withContext = timeoutPromise(timeout, promise, description).catch((e: unknown) => {
    if (!(e instanceof TimeoutError)) throw e;
    throw new TimeoutError(`${e.message} — last: ${safeStringify(lastSeenValue)}`);
  });
  return withContext as WaitUntilReturn<T>;
}

/**
 * Recursive helper for waitUntilWithReload: polls asyncTest and reloads the page on timeout.
 * Counts remaining reload attempts via `left` and accumulated reloads via `used`.
 *
 * @param page - the Playwright Page to reload when polling times out
 * @param asyncTest - the async predicate to poll at each attempt
 * @param opts - internal counters and timing config for the recursive retry loop
 * @param opts.label - human-readable description for diagnostics
 * @param opts.pollTimeout - maximum time in ms to poll before reloading
 * @param opts.interval - polling interval in ms between asyncTest calls
 * @param opts.left - remaining reload attempts before giving up
 * @param opts.used - number of reloads already performed
 * @returns a IReloadRetryResult describing whether the value was found and how many reloads were used
 */
async function retryWithReload<T>(
  page: Page,
  asyncTest: () => Promise<T>,
  opts: { label: string; pollTimeout: number; interval: number; left: number; used: number },
): Promise<IReloadRetryResult<T>> {
  const { label, pollTimeout, interval, left, used } = opts;
  const result = await waitUntil(asyncTest, label, { timeout: pollTimeout, interval }).catch(
    () => null,
  );
  if (result !== null)
    return { found: true, value: result as NonNullable<T>, reloadsUsed: used, description: label };
  if (left <= 0) return { found: false, reloadsUsed: used, description: label };
  await page.reload({ waitUntil: 'networkidle' });
  return retryWithReload(page, asyncTest, { ...opts, left: left - 1, used: used + 1 });
}

/**
 * Like waitUntil, but reloads the page on timeout and retries up to reloadAttempts times.
 * Returns a result object — never throws. Caller decides what to do when found=false.
 * Use when a bank's SPA needs a page refresh to complete post-login JS initialization
 * (e.g. writing an auth token to sessionStorage) that stalls in headless mode.
 *
 * @param page - the Playwright Page to reload when polling times out
 * @param asyncTest - the async predicate to poll; the wait ends when it returns truthy
 * @param opts - configuration for the retry loop
 * @param opts.description - a human-readable label for diagnostics; defaults to 'waitUntilWithReload'
 * @param opts.pollTimeout - maximum time in ms to wait at each attempt before reloading; defaults to 20000
 * @param opts.reloadAttempts - maximum number of page reloads before giving up; defaults to 2
 * @param opts.interval - polling interval in ms between each asyncTest call; defaults to 500
 * @returns a IReloadRetryResult with found=true and value, or found=false when all attempts fail
 */
export async function waitUntilWithReload<T>(
  page: Page,
  asyncTest: () => Promise<T>,
  opts: { description?: string; pollTimeout?: number; reloadAttempts?: number; interval?: number },
): Promise<IReloadRetryResult<T>> {
  const {
    description = 'waitUntilWithReload',
    pollTimeout = 20_000,
    reloadAttempts = 2,
    interval = 500,
  } = opts;
  return retryWithReload(page, asyncTest, {
    label: description,
    pollTimeout,
    interval,
    left: reloadAttempts,
    used: 0,
  });
}

/**
 * Races a promise against a timeout, silently swallowing TimeoutError when it expires.
 * Other errors thrown by the promise are re-thrown normally.
 *
 * @param ms - the timeout duration in milliseconds
 * @param promise - the promise to race against the timeout
 * @returns the promise result, or undefined when the timeout fires first
 */
export function raceTimeout<T>(ms: number, promise: Promise<T>): Promise<T | IDoneResult> {
  return timeoutPromise(ms, promise, 'timeout').catch((err: unknown) => {
    if (!(err instanceof TimeoutError)) throw err;
    return { done: true } as IDoneResult;
  });
}

/**
 * Executes an array of async action functions sequentially, collecting their results.
 * Each action waits for the previous one to complete before starting.
 *
 * @param actions - an array of zero-argument async functions to execute in order
 * @returns a promise that resolves with an array of each action's result in order
 */
export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  const emptyResult = new Array<T>();
  const initial = Promise.resolve<T[]>(emptyResult);
  return actions.reduce((m, a) => m.then(async x => [...x, await a()]), initial);
}

/**
 * Pauses execution for the specified number of milliseconds.
 *
 * @param ms - the duration to sleep in milliseconds
 * @returns a done result indicating the sleep completed
 */
export function sleep(ms: number): Promise<IDoneResult> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ done: true });
    }, ms);
  });
}

/**
 * Introduces a random delay that mimics human interaction timing to reduce bot-detection risk.
 * The delay is uniformly distributed between minMs and maxMs.
 *
 * @param minMs - the minimum delay in milliseconds; defaults to 300
 * @param maxMs - the maximum delay in milliseconds; defaults to 1200
 * @returns a done result indicating the delay completed
 */
export function humanDelay(minMs = 300, maxMs = 1200): Promise<IDoneResult> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return sleep(delay);
}
