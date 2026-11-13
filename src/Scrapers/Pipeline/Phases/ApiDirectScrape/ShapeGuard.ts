/**
 * Guarded boundary for bank-shape callbacks.
 *
 * A shape is data plus a handful of callbacks, and a callback that throws would
 * otherwise escape the phase's `Procedure` contract: `PipelineExecutor`'s
 * cleanup catch would still see it, but `runScrapeWithRecovery` would not, so a
 * warm session that served an unusable body could never re-login and retry
 * once. Every callback at that boundary — the seven that read a payload or
 * decide the walk — therefore funnels through here, turning one throw into one
 * typed `Generic` failure that names the callback.
 *
 * <p>Dispatch-argument builders (`accountNumberOf`, the `buildVars` family,
 * URL and header producers) run earlier, while a request is being assembled,
 * and stay outside this guard: they cannot return a `Procedure` without
 * reshaping dispatch, and a throw there is a programming error rather than an
 * unusable response.
 *
 * <p>The callbacks that vet or consume a bank answer (body checks and the
 * response-session patch) use {@link guardAnswerCallback}, which converts a throw
 * the same way but carries the error class, never the thrown message.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { errorNameOf, toError } from '../../Types/ErrorUtils.js';
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

/**
 * Turn a caught throw from a callback that reads a bank answer into a typed
 * failure naming the callback and the error class, never the thrown message.
 *
 * <p>The message of a throw raised while reading an answer (a parse error, say)
 * can quote that answer, so unlike {@link shapeThrew} it is not carried.
 * @param name - Callback identity carried by the failure message.
 * @param error - The caught value.
 * @returns A `Generic` failure naming the callback and the error class.
 */
function answerCallbackThrew<T>(name: string, error: unknown): Procedure<T> {
  const kind = errorNameOf(error);
  return fail(ScraperErrorTypes.Generic, `shape ${name} threw: ${kind}`);
}

/**
 * Run one `Procedure`-returning callback that reads a bank answer (a body
 * check or a response-session patch) under the redacting boundary.
 *
 * <p>The converted failure is a plain `Generic` one, so `shouldRecoverSession`
 * applies its ordinary rules to it: a warm per-request session recovers at most
 * once, a cold one never does, and whole-scrape recovery needs a 401 or 403. The
 * callback's own typed rejection, a WAF or integrity refusal included, is
 * returned untouched and keeps its own recovery behavior.
 * @param name - Callback identity carried by any converted failure.
 * @param invoke - The callback invocation.
 * @returns The callback's procedure, or a typed `Generic` failure when it throws.
 */
export function guardAnswerCallback<T>(name: string, invoke: () => Procedure<T>): Procedure<T> {
  try {
    return invoke();
  } catch (error) {
    return answerCallbackThrew(name, error);
  }
}
