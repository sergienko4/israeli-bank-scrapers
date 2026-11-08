/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

import type { Brand } from './Brand.js';

/** Normalised error message — branded for Rule #15. */
type ErrorMessageString = Brand<string, 'ErrorMessageString'>;

/**
 * Safely extract a message string from an Error or a string.
 *
 * Accepts only those two types by signature. For a genuinely unknown caught
 * value use {@link toError} instead: casting `unknown` to `Error` to satisfy
 * this signature returns the value unchanged, so a thrown `Symbol` throws
 * again on interpolation and escapes the very catch block meant to contain it.
 * @param error - The caught Error or string.
 * @returns `Error.message` for Error instances, otherwise the string itself.
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

/**
 * Names safe to log: the platform's error classes and this library's own,
 * whose names are fixed. Any name a caller sets, however class-like, can
 * spell a code or a token, so it is not here.
 */
const LOGGABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AbortError',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'ScraperError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
  'WafBlockError',
]);

/**
 * Read a caught value's `name` without letting a getter throw.
 * @param error - The unknown caught value.
 * @returns The name, or '' when it is not a readable string.
 */
function readErrorName(error: unknown): string {
  try {
    const name: unknown = toError(error).name;
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

/**
 * The name of a caught value, safe to log. A thrown value sets its own
 * `name`, so only a platform or library error class (e.g. `TypeError`,
 * `ScraperError`) is reported by name; any other name is reported as `'Error'`.
 * @param error - The unknown caught value.
 * @returns A platform or library error class name, or `'Error'`.
 */
function errorNameOf(error: unknown): string {
  const name = readErrorName(error);
  if (LOGGABLE_ERROR_NAMES.has(name)) return name;
  return 'Error';
}

/**
 * Shape of a system or undici error code (`ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`).
 * A cause carries arbitrary text, so only a value of this shape is ever reported.
 */
const CAUSE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,40}$/;

/**
 * Read one property of an object-like value.
 * @param value - Any value; a primitive has no properties.
 * @param field - The property name.
 * @returns The property value, or '' when `value` is not an object.
 */
function readField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return '';
  return Reflect.get(value, field);
}

/**
 * The machine-readable code of a failure's underlying cause, safe to log.
 * Node's fetch rejects with a bare `fetch failed` and keeps the real reason
 * (a connect timeout, a reset) in `error.cause.code`.
 * @param error - The unknown caught value, from any realm.
 * @returns The code (e.g. `UND_ERR_CONNECT_TIMEOUT`), or '' when there is no
 *   well-formed one.
 */
function errorCauseCodeOf(error: unknown): string {
  try {
    const cause = readField(error, 'cause');
    const code = readField(cause, 'code');
    return typeof code === 'string' && CAUSE_CODE_PATTERN.test(code) ? code : '';
  } catch {
    return '';
  }
}

export default toErrorMessage;
export { errorCauseCodeOf, errorNameOf, toError, toErrorMessage, UNREPRESENTABLE_ERROR };
