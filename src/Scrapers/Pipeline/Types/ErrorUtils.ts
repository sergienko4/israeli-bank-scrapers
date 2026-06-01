/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

import type { Brand } from './Brand.js';

/** Normalised error message — branded for Rule #15. */
type ErrorMessageString = Brand<string, 'ErrorMessageString'>;

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message: Error.message for Error instances, the string itself for strings, or `String(error)` for other values.
 */
function toErrorMessage(error: Error | string): ErrorMessageString {
  if (error instanceof Error) return error.message as ErrorMessageString;
  return error as ErrorMessageString;
}

/**
 * Sentinel returned by {@link safeStringify} when coercion itself throws.
 * Some objects override `toString` or `Symbol.toPrimitive` to throw —
 * the "never throws" contract demands a fallback string.
 */
const UNREPRESENTABLE_ERROR = '[unrepresentable error value]';

/**
 * Safely coerce any value to a string. `String(value)` throws when a
 * thrown object's `toString` / `Symbol.toPrimitive` itself throws;
 * this helper catches that case and returns {@link UNREPRESENTABLE_ERROR}.
 *
 * @param value - The unknown value to stringify.
 * @returns The string form of `value`, or the sentinel on failure.
 */
function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return UNREPRESENTABLE_ERROR;
  }
}

/**
 * Normalise any caught value into a real `Error` instance so
 * downstream classifiers can safely read `.message`. JavaScript
 * permits `throw 'string'` / `throw 42` / `throw {…}`; a naive
 * `(caught as Error).message.includes(…)` then crashes with a
 * `TypeError`. Modules that contract "always resolves; never
 * throws" (e.g. `NavigationTransportProbe`) must funnel every
 * `catch` through this helper. Coercion failures fall back to
 * {@link UNREPRESENTABLE_ERROR} so the contract holds even for
 * pathological values whose `toString` throws.
 *
 * @param error - The unknown caught value.
 * @returns An `Error` whose `.message` reflects the original throw:
 *   the original error if already an Error, the string itself when
 *   thrown directly, or the safely-stringified form for any other
 *   value (including pathological objects whose toString throws).
 */
/**
 * Cross-realm-safe `Error` check. `instanceof Error` returns `false`
 * for Errors created in another JS realm (Node `vm` contexts, browser
 * iframes, jest's experimental-vm-modules) even when the value is a
 * fully-formed Error with `.message` / `.stack` / `.code`. The
 * `[[Class]]` brand survives realm crossings, so duck-typing via
 * `Object.prototype.toString.call` is the canonical realm-safe check.
 *
 * @param value - The unknown value to inspect.
 * @returns `true` if `value` is an Error in any realm.
 */
function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true;
  return Object.prototype.toString.call(value) === '[object Error]';
}

/**
 * Normalise any caught value into a real `Error` instance so
 * downstream classifiers can safely read `.message`. JavaScript
 * permits `throw 'string'` / `throw 42` / `throw {…}`; a naive
 * `(caught as Error).message.includes(…)` then crashes with a
 * `TypeError`. Modules that contract "always resolves; never
 * throws" (e.g. `NavigationTransportProbe`) must funnel every
 * `catch` through this helper. Coercion failures fall back to
 * {@link UNREPRESENTABLE_ERROR} so the contract holds even for
 * pathological values whose `toString` throws. Cross-realm Errors
 * (jest VM modules, Node `vm` contexts, browser iframes) are
 * detected via {@link isErrorLike} so their `.code` / `.errno`
 * fields survive normalization.
 *
 * @param error - The unknown caught value.
 * @returns An `Error` whose `.message` reflects the original throw:
 *   the original error if Error-shaped (any realm), the string
 *   itself when thrown directly, or the safely-stringified form for
 *   any other value (including pathological objects whose toString
 *   throws).
 */
function toError(error: unknown): Error {
  if (isErrorLike(error)) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(safeStringify(error));
}

export default toErrorMessage;
export { toError, toErrorMessage, UNREPRESENTABLE_ERROR };
