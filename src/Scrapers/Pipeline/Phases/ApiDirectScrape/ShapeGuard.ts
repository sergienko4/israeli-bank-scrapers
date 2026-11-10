/**
 * Guarded boundary for bank-shape callbacks.
 *
 * A shape is data plus a handful of callbacks, and a callback that throws would
 * otherwise escape the phase's `Procedure` contract: `PipelineExecutor`'s
 * cleanup catch would still see it, but `runScrapeWithRecovery` would not, so a
 * warm session that served an unusable body could never re-login and retry
 * once. Every shape invocation therefore funnels through here, turning one
 * throw into one typed `Generic` failure that names the callback.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { toError } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/**
 * Turn a caught shape throw into the phase's typed failure.
 *
 * <p>Normalising through `toError` also contains a non-`Error` throw: a
 * `Symbol` throws a second time when interpolated, which would escape the catch
 * block meant to contain it.
 *
 * @param name - Callback identity carried by the failure message.
 * @param error - The caught value.
 * @returns A `Generic` failure naming the callback that threw.
 */
function shapeThrew<T>(name: string, error: unknown): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, `shape ${name} threw: ${toError(error).message}`);
}

/**
 * Run one value-returning shape callback under the guarded boundary.
 * @param name - Callback identity carried by the failure message.
 * @param invoke - The callback invocation.
 * @returns The callback's value, or a typed `Generic` failure when it throws.
 */
export function guardShape<T>(name: string, invoke: () => T): Procedure<T> {
  try {
    const value = invoke();
    return succeed(value);
  } catch (error) {
    return shapeThrew(name, error);
  }
}

/**
 * Run one `Procedure`-returning shape callback under the same boundary.
 *
 * <p>The callback already speaks `Procedure`, but it can still throw before
 * producing one — a shape reading a missing field while building its failure.
 * Wrapping the invocation keeps that throw from escaping while preserving the
 * callback's own typed rejection.
 *
 * @param name - Callback identity carried by any converted failure.
 * @param invoke - The callback invocation.
 * @returns The callback's procedure, or a typed `Generic` failure when it throws.
 */
export function guardShapeProcedure<T>(name: string, invoke: () => Procedure<T>): Procedure<T> {
  try {
    return invoke();
  } catch (error) {
    return shapeThrew(name, error);
  }
}
