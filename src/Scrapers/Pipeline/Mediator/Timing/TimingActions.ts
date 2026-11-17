/**
 * Timing utilities — raceTimeout over the shared callback deadline.
 *
 * <p>The deadline owns its timer and clears it when the race settles, including
 * the abort path, so a long budget never keeps the process alive after a
 * cancelled or completed wait.
 */

import withCallbackDeadline from '../../Types/CallbackDeadline.js';
import { toError } from '../../Types/ErrorUtils.js';

/** Sentinel indicating the race timed out before the promise resolved. */
export const RACE_TIMED_OUT = Symbol('RACE_TIMED_OUT');

/**
 * Convert a callback-deadline rejection into the race sentinel or a rethrow.
 * @param error - The rejected value.
 * @returns The timeout sentinel.
 */
function timeoutSentinel(error: unknown): typeof RACE_TIMED_OUT {
  if (toError(error).message === 'callback timed out') return RACE_TIMED_OUT;
  throw error;
}

/**
 * Race a promise against a timeout and the current run signal.
 * @param ms - The timeout duration in milliseconds.
 * @param promise - The promise to race.
 * @returns The resolved value, or RACE_TIMED_OUT if the timeout wins.
 * @throws The promise's rejection, or the run-abort error.
 */
export async function raceTimeout<T>(
  ms: number,
  promise: Promise<T>,
): Promise<T | typeof RACE_TIMED_OUT> {
  try {
    return await withCallbackDeadline(promise, ms);
  } catch (error) {
    return timeoutSentinel(error);
  }
}
