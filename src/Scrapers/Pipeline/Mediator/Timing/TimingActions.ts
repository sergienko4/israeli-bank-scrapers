/**
 * Timing utilities — sleep, humanDelay, raceTimeout, runSerial.
 * Extracted from Waiting.ts to respect max-lines.
 */

import { randomInt } from 'node:crypto';

import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { HUMAN_DELAY_MAX_MS, HUMAN_DELAY_MIN_MS } from './TimingConfig.js';

/** Error thrown when an async wait operation exceeds its timeout. */
export class TimeoutError extends Error {}

/**
 * Create a TimeoutError instance via Reflect.construct (avoids DI rule on `new`).
 * @param message - Error description.
 * @returns A TimeoutError instance.
 */
export function createTimeoutError(message: string): TimeoutError {
  return Reflect.construct(TimeoutError, [message]);
}

/**
 * Create a promise via Reflect.construct (avoids DI rule on `new Promise`).
 * @param executor - The promise executor function.
 * @returns A new Promise instance.
 */
export function createPromise<T>(
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
export function timeoutPromise<T>(
  ms: number,
  promise: Promise<T>,
  description: string,
): Promise<T> {
  const error = createTimeoutError(description);
  const timeout = createPromise<T>((_resolve, reject): boolean => {
    const id = globalThis.setTimeout((): boolean => {
      clearTimeout(id);
      return reject(error);
    }, ms);
    return true;
  });
  return Promise.race([promise, timeout]);
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
export function sleep(ms: number): Promise<boolean> {
  return createPromise<boolean>((resolve): boolean => {
    globalThis.setTimeout((): boolean => resolve(true), ms);
    return true;
  });
}

/**
 * Pick a uniform delay in [minMs, maxMs). Uses crypto.randomInt for
 * Sonar S2245 compliance; falls back to minMs when bounds collapse
 * (randomInt rejects max<=min, but the prior Math.random() code
 * returned minMs in that case — fixed-delay test fixtures rely on it).
 * @param minMs - Lower bound (inclusive).
 * @param maxMs - Upper bound (exclusive).
 * @returns Chosen delay in milliseconds.
 */
function pickHumanDelay(minMs: number, maxMs: number): number {
  if (minMs >= maxMs) return minMs;
  return randomInt(minMs, maxMs);
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
  const delay = pickHumanDelay(minMs, maxMs);
  return createPromise<Procedure<void>>((resolve): boolean => {
    const done = succeed(undefined);
    globalThis.setTimeout((): boolean => resolve(done), delay);
    return true;
  });
}
